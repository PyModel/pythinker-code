import { existsSync } from 'node:fs';
import { readFile, mkdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertAgentRecord,
  assertAgentWireProtocolVersion,
  parseSessionMetadata,
} from '@pymodel/agent-core';

import { OldSessionStateSchema, type OldSessionState } from '../pythinker-cli-schema.js';
import { targetSessionsDir } from '../paths.js';
import { computeWorkdirBucket } from './workdir-bucket.js';
import { closeDanglingToolCalls } from './close-tool-calls.js';
import {
  analyzeContextContent,
  translateContextLines,
  type NormalizedMessage,
} from './translator.js';
import { writeMainAgentWire } from './wire-writer.js';
import { writeSessionState } from './state-writer.js';

export type MigrateOneResult =
  | { readonly outcome: 'migrated'; readonly targetDir: string }
  | { readonly outcome: 'already-migrated'; readonly targetDir: string }
  | {
      readonly outcome: 'conflict';
      readonly targetDir: string;
      readonly reason: ExistingTargetConflictReason;
    }
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'failed'; readonly reason: string };

export interface MigrateOneInput {
  readonly sourceSessionDir: string;
  readonly oldSessionUuid: string;
  readonly workdirPath: string;
  readonly targetHome: string;
}

type ExistingTargetConflictReason =
  | 'foreign-target'
  | 'incomplete-target'
  | 'incompatible-import-format';

export async function migrateOneSession(input: MigrateOneInput): Promise<MigrateOneResult> {
  const bucket = computeWorkdirBucket(input.workdirPath);
  const targetDir = join(targetSessionsDir(input.targetHome), bucket, `ses_${input.oldSessionUuid}`);

  if (existsSync(targetDir)) {
    const cls = await classifyExistingTarget(targetDir);
    // A dir we wrote ourselves on a previous run — idempotent re-run.
    if (cls === 'imported') {
      return { outcome: 'already-migrated', targetDir };
    }
    return { outcome: 'conflict', targetDir, reason: cls };
  }

  let oldState: Partial<OldSessionState> = {};
  try {
    const stateText = await readFile(join(input.sourceSessionDir, 'state.json'), 'utf-8');
    oldState = OldSessionStateSchema.parse(JSON.parse(stateText));
  } catch {
    // missing or corrupt state — proceed with defaults
  }

  let messages: NormalizedMessage[] = [];
  let lastUserPrompt = '';
  let contextLines: readonly string[] = [];
  try {
    const contextText = await readFile(join(input.sourceSessionDir, 'context.jsonl'), 'utf-8');
    contextLines = contextText.split(/\r?\n/);
    messages = closeDanglingToolCalls(translateContextLines(contextLines));
    lastUserPrompt = extractLastUserText(messages);
  } catch {
    return { outcome: 'failed', reason: 'cannot read context.jsonl' };
  }

  if (messages.length === 0) {
    // No `user`/`assistant`/`tool` rows survived translation. Re-analyze the
    // raw lines to tell a genuinely empty/cleared session apart from one
    // whose every line failed to parse — the latter is a real data problem
    // and must show up in `migration-errors.log`, not get silently lumped in
    // with skipped-empty. `classifySessionDir` normally catches both ahead
    // of time; this stays as a defense-in-depth safety net.
    if (analyzeContextContent(contextLines) === 'corrupt') {
      return {
        outcome: 'failed',
        reason: 'context.jsonl is corrupt: no parseable JSON lines',
      };
    }
    return { outcome: 'empty' };
  }

  const wireMtimeS = oldState.wire_mtime ?? null;
  let createdAtMs: number;
  if (wireMtimeS !== null && wireMtimeS !== undefined) {
    createdAtMs = Math.floor(wireMtimeS * 1000);
  } else {
    // No recorded `wire_mtime`: fall back to the source `wire.jsonl` mtime —
    // the SAME signal `migrateSessionsStep`/detection rank recency by — so
    // post-migration `SessionStore.list()` ordering matches the detected
    // "most recent" order. `Date.now()` would stamp every such session with
    // the migration time and break resume ordering.
    try {
      createdAtMs = Math.floor(
        (await stat(join(input.sourceSessionDir, 'wire.jsonl'))).mtimeMs,
      );
    } catch {
      createdAtMs = Date.now();
    }
  }

  let wireProtocolFromOld: string | null = null;
  try {
    const oldWire = await readFile(join(input.sourceSessionDir, 'wire.jsonl'), 'utf-8');
    const firstLine = oldWire.split(/\r?\n/)[0];
    if (firstLine !== undefined && firstLine.length > 0) {
      const parsed: unknown = JSON.parse(firstLine);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof (parsed as { protocol_version?: unknown }).protocol_version === 'string'
      ) {
        wireProtocolFromOld = (parsed as { protocol_version: string }).protocol_version;
      }
    }
  } catch {
    // ignore
  }

  let createdTarget = false;
  try {
    await mkdir(join(targetSessionsDir(input.targetHome), bucket), { recursive: true, mode: 0o700 });
    await mkdir(targetDir, { mode: 0o700 });
    createdTarget = true;
    await writeMainAgentWire(targetDir, { createdAtMs, messages });
    await writeSessionState(targetDir, {
      oldState,
      lastUserPrompt,
      sourcePath: input.sourceSessionDir,
      oldSessionUuid: input.oldSessionUuid,
      wireProtocolFromOld,
      createdAtMs,
    });
  } catch (error) {
    // Only remove the exact target created by this attempt. Existing targets
    // are conflicts for an operator to inspect, never debris to overwrite.
    if (createdTarget) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { outcome: 'failed', reason };
  }

  // pythinker-core's `SessionStore.list()` ranks sessions by the *filesystem*
  // mtimes of `state.json` / `wire.jsonl` / the session dir — not by the
  // `updatedAt` field. Writing newest-first would otherwise make the newest
  // original session the oldest by mtime, inverting `--continue` ordering.
  // Stamp the artifacts with the session's original timestamp so `list()`
  // reflects true recency. A utimes failure must never abort the session;
  // it only leaves ordering slightly off.
  await applyOriginalMtime(targetDir, createdAtMs);

  return { outcome: 'migrated', targetDir };
}

/**
 * Set the filesystem mtime of the migrated session artifacts to the session's
 * original timestamp. The session directory is stamped LAST, since writing
 * files into it bumps the directory mtime.
 */
async function applyOriginalMtime(targetDir: string, createdAtMs: number): Promise<void> {
  const stamp = new Date(createdAtMs);
  try {
    await utimes(join(targetDir, 'agents', 'main', 'wire.jsonl'), stamp, stamp);
    await utimes(join(targetDir, 'state.json'), stamp, stamp);
    await utimes(targetDir, stamp, stamp);
  } catch {
    // Non-fatal: ordering may be slightly off, but the migration succeeded.
  }
}

type ExistingTarget = 'imported' | ExistingTargetConflictReason;

/**
 * Classify an existing `targetDir`:
 *  - `imported`: a complete dir written by a previous run of this migrator.
 *  - `foreign-target`: a real, unrelated pythinker-code session occupies the path.
 *  - `incomplete-target`: state is absent or corrupt and cannot be trusted.
 *  - `incompatible-import-format`: this migrator's marker exists, but the
 *    persisted state or canonical main-agent wire no longer passes current gates.
 */
async function classifyExistingTarget(targetDir: string): Promise<ExistingTarget> {
  let text: string;
  try {
    text = await readFile(join(targetDir, 'state.json'), 'utf-8');
  } catch {
    return 'incomplete-target';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'incomplete-target';
  }
  if (!isRecord(parsed)) return 'incomplete-target';
  if (!hasImportMarker(parsed)) return 'foreign-target';
  try {
    parseSessionMetadata(parsed);
    await assertCurrentMainAgentWire(targetDir);
    return 'imported';
  } catch {
    return 'incompatible-import-format';
  }
}

function hasImportMarker(state: Record<string, unknown>): boolean {
  const custom = state['custom'];
  return isRecord(custom) && custom['imported_from_pythinker_cli'] === true;
}

async function assertCurrentMainAgentWire(targetDir: string): Promise<void> {
  const wirePath = join(targetDir, 'agents', 'main', 'wire.jsonl');
  const raw = await readFile(wirePath, 'utf-8');
  const lines = raw.split('\n');
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      if (i === lines.length - 1) break;
      throw error;
    }
    assertAgentRecord(record);
    if (first) {
      if (record.type !== 'metadata') {
        throw new Error('wire.jsonl expected metadata as the first record');
      }
      assertAgentWireProtocolVersion(record.protocol_version);
      first = false;
    }
  }
  if (first) {
    throw new Error('wire.jsonl expected metadata as the first record');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractLastUserText(messages: readonly NormalizedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m === undefined) continue;
    if (m.role !== 'user') continue;
    const textPart = m.content.find((p) => p.type === 'text');
    if (textPart && textPart.type === 'text') return textPart.text;
  }
  return '';
}
