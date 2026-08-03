import { readFile } from 'node:fs/promises';
import { join } from 'pathe';

import {
  assertAgentRecord,
  assertAgentWireProtocolVersion,
  type AgentRecord,
} from '../../agent/records';

export interface SessionWireScan {
  readonly firstActivityMs?: number | undefined;
  readonly lastActivityMs?: number | undefined;
  readonly lastUserMessageMs?: number | undefined;
  readonly firstUserInput?: string | undefined;
}

export async function scanSessionWire(sessionDir: string): Promise<SessionWireScan> {
  let raw: string;
  try {
    raw = await readFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), 'utf-8');
  } catch (error) {
    if (isFileNotFound(error)) return {};
    throw error;
  }

  let firstActivityMs: number | undefined;
  let lastActivityMs: number | undefined;
  let lastUserMessageMs: number | undefined;
  let firstUserInput: string | undefined;
  let first = true;
  const lines = raw.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      if (i === lines.length - 1) break;
      throw new Error(`wire.jsonl: corrupted line ${i + 1}: ${String(error)}`, { cause: error });
    }
    assertAgentRecord(record);
    if (first) {
      if (record.type !== 'metadata') {
        throw new Error('wire.jsonl expected metadata as the first record');
      }
      assertAgentWireProtocolVersion(record.protocol_version);
      first = false;
    }
    updateScan(record);
  }

  return {
    firstActivityMs,
    lastActivityMs,
    lastUserMessageMs,
    firstUserInput,
  };

  function updateScan(record: AgentRecord): void {
    const timeMs = record.time === undefined ? undefined : normalizeTimestampMs(record.time);
    if (timeMs !== undefined) {
      firstActivityMs ??= timeMs;
      lastActivityMs = timeMs;
    }
    if (record.type !== 'turn.prompt') return;
    if (timeMs !== undefined) lastUserMessageMs = timeMs;
    if (firstUserInput === undefined) {
      firstUserInput = textInput(record);
    }
  }
}

function textInput(record: Extract<AgentRecord, { readonly type: 'turn.prompt' }>): string | undefined {
  const text = record.input
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim();
  return text.length === 0 ? undefined : text;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export function normalizeTimestampMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
}
