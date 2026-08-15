import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';

import { ErrorCodes, PythinkerError } from '#/errors';
import { parseSessionMetadata, type SessionMeta } from '../index';
import type { SessionIndexEntry } from '#/session/store/session-index';
import { appendSessionIndexEntry, readSessionIndex } from '#/session/store/session-index';
import { encodeWorkDirKey, normalizeWorkDir } from '#/session/store/workdir-key';
import type { JsonObject, ListSessionsPayload, SessionSummary } from '#/rpc/core-api';
import { FileSystemAgentRecordPersistence, type AgentRecordOf } from '../../agent/records';

const FORKED_SESSION_DROPPED_FILES = ['upcoming-goals.json'] as const;

export interface CreateSessionRecordInput {
  readonly id: string;
  readonly workDir: string;
}

export interface ForkSessionRecordInput {
  readonly sourceId: string;
  readonly targetId: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
}

export interface SessionStoreOptions {
  readonly resolveWorkspaceId?: (workDir: string) => Promise<string | undefined>;
}

export class SessionStore {
  readonly sessionsDir: string;
  private readonly resolveWorkspaceId: SessionStoreOptions['resolveWorkspaceId'];

  constructor(
    readonly homeDir: string,
    options: SessionStoreOptions = {},
  ) {
    this.sessionsDir = join(homeDir, 'sessions');
    this.resolveWorkspaceId = options.resolveWorkspaceId;
  }

  sessionDirFor(input: { readonly id: string; readonly workDir: string }): string {
    assertSafeSessionId(input.id);
    return join(this.sessionsDir, encodeWorkDirKey(normalizeWorkDir(input.workDir)), input.id);
  }

  private async bucketKeyFor(workDir: string): Promise<string> {
    let resolved: string | undefined;
    try {
      resolved = await this.resolveWorkspaceId?.(workDir);
    } catch {
      resolved = undefined;
    }
    return resolved !== undefined && isSafeSessionId(resolved)
      ? resolved
      : encodeWorkDirKey(normalizeWorkDir(workDir));
  }

  private async resolvedSessionDirFor(input: {
    readonly id: string;
    readonly workDir: string;
  }): Promise<string> {
    assertSafeSessionId(input.id);
    return join(this.sessionsDir, await this.bucketKeyFor(input.workDir), input.id);
  }

  async create(
    input: CreateSessionRecordInput,
    initialize: (summary: SessionSummary) => Promise<void>,
  ): Promise<SessionSummary> {
    assertSafeSessionId(input.id);
    const workDir = normalizeWorkDir(input.workDir);
    const indexed = await this.findSessionEntry(input.id);
    if (indexed !== undefined) {
      throw new PythinkerError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.id}" already exists`);
    }

    const dir = await this.resolvedSessionDirFor({ id: input.id, workDir });
    if (await isDirectory(dir)) {
      throw new PythinkerError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.id}" already exists`);
    }

    let created = false;
    try {
      await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
      await mkdir(dir, { mode: 0o700 });
      created = true;
      await initialize(await this.unpublishedSummary(input.id, dir, workDir));
      const summary = await this.summaryFromDir(input.id, dir, workDir);
      await appendSessionIndexEntry(this.homeDir, {
        sessionId: input.id,
        sessionDir: dir,
        workDir,
      });
      return summary;
    } catch (error) {
      if (created) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  async fork(input: ForkSessionRecordInput): Promise<SessionSummary> {
    const source = await this.findExistingSessionEntry(input.sourceId);
    const sourceState = await readSessionState(source.sessionDir, input.sourceId);
    assertSafeSessionId(input.targetId);
    const indexed = await this.findSessionEntry(input.targetId);
    if (indexed !== undefined) {
      throw new PythinkerError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.targetId}" already exists`);
    }

    const targetDir = await this.resolvedSessionDirFor({ id: input.targetId, workDir: source.workDir });
    if (await isDirectory(targetDir)) {
      throw new PythinkerError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.targetId}" already exists`);
    }

    await mkdir(dirname(targetDir), { recursive: true, mode: 0o700 });
    try {
      await cp(source.sessionDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await dropForkedSessionFiles(targetDir);
      const forkedState = await writeForkedState(input, sourceState, targetDir);
      await appendForkedMarkers(targetDir, forkedState);
      const summary = await this.summaryFromDir(input.targetId, targetDir, source.workDir);
      await appendSessionIndexEntry(this.homeDir, {
        sessionId: input.targetId,
        sessionDir: targetDir,
        workDir: source.workDir,
      });
      return summary;
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async get(id: string): Promise<SessionSummary> {
    const entry = await this.findExistingSessionEntry(id);
    return this.summaryFromDir(id, entry.sessionDir, entry.workDir);
  }

  async rename(id: string, title: string): Promise<void> {
    const normalized = title.trim();
    if (normalized.length === 0) {
      throw new PythinkerError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    const entry = await this.findExistingSessionEntry(id);
    const state = await readSessionState(entry.sessionDir, id);
    const next = parseSessionMetadata({
      ...state,
      title: normalized,
      isCustomTitle: true,
    });
    await writeState(entry.sessionDir, next);
  }

  async archive(id: string): Promise<SessionSummary> {
    const entry = await this.findExistingSessionEntry(id);
    const state = await readSessionState(entry.sessionDir, id);
    const next = parseSessionMetadata({
      ...state,
      archived: true,
      updatedAt: new Date().toISOString(),
    });
    await writeState(entry.sessionDir, next);
    return this.summaryFromDir(id, entry.sessionDir, entry.workDir);
  }

  async list(options: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    const workDir =
      options.workDir === undefined ? undefined : normalizeRequiredWorkDir(options.workDir);
    const sessionId = normalizeOptionalSessionId(options.sessionId);
    const includeArchive = options.includeArchive === true;

    if (workDir !== undefined) {
      if (sessionId !== undefined) {
        const local = await this.summaryFromWorkDirSession(sessionId, workDir, includeArchive);
        if (local !== undefined) return [local];
        return this.listSessionId(sessionId, includeArchive);
      }
      return this.listWorkDir(workDir, includeArchive);
    }

    if (sessionId !== undefined) {
      return this.listSessionId(sessionId, includeArchive);
    }
    return this.listAll(includeArchive);
  }

  private async listWorkDir(
    workDir: string,
    includeArchive: boolean,
  ): Promise<readonly SessionSummary[]> {
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    const sessions: SessionSummary[] = [];
    for (const entry of index.values()) {
      if (entry.workDir !== workDir || !(await isDirectory(entry.sessionDir))) continue;
      const summary = await this.trySummaryFromDir(entry.sessionId, entry.sessionDir, entry.workDir);
      if (summary === undefined) continue;
      if (!includeArchive && summary.archived === true) continue;
      sessions.push(summary);
    }
    sessions.sort(compareSessionSummary);
    return sessions;
  }

  private async listSessionId(
    sessionId: string,
    includeArchive: boolean,
  ): Promise<readonly SessionSummary[]> {
    try {
      const summary = await this.get(sessionId);
      if (!includeArchive && summary.archived === true) return [];
      return [summary];
    } catch (error) {
      if (error instanceof PythinkerError && error.code === ErrorCodes.SESSION_NOT_FOUND) {
        return [];
      }
      throw error;
    }
  }

  private async listAll(includeArchive: boolean): Promise<readonly SessionSummary[]> {
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    const sessions: SessionSummary[] = [];
    for (const entry of index.values()) {
      if (!(await isDirectory(entry.sessionDir))) continue;
      const summary = await this.trySummaryFromDir(entry.sessionId, entry.sessionDir, entry.workDir);
      if (summary === undefined) continue;
      if (!includeArchive && summary.archived === true) continue;
      sessions.push(summary);
    }
    sessions.sort(compareSessionSummary);
    return sessions;
  }

  private async summaryFromWorkDirSession(
    sessionId: string,
    workDir: string,
    includeArchive: boolean,
  ): Promise<SessionSummary | undefined> {
    const entry = await this.findSessionEntry(sessionId);
    if (entry === undefined || entry.workDir !== workDir || !(await isDirectory(entry.sessionDir))) {
      return undefined;
    }
    const summary = await this.trySummaryFromDir(sessionId, entry.sessionDir, entry.workDir);
    if (summary === undefined) return undefined;
    if (!includeArchive && summary.archived === true) return undefined;
    return summary;
  }

  async assertDirectory(id: string): Promise<string> {
    const entry = await this.findExistingSessionEntry(id);
    await readSessionState(entry.sessionDir, id);
    return entry.sessionDir;
  }

  private async findSessionEntry(id: string): Promise<SessionIndexEntry | undefined> {
    if (!isSafeSessionId(id)) return undefined;
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    return index.get(id);
  }

  private async findExistingSessionEntry(id: string): Promise<SessionIndexEntry> {
    const entry = await this.findSessionEntry(id);
    if (entry !== undefined && (await isDirectory(entry.sessionDir))) return entry;
    throw new PythinkerError(ErrorCodes.SESSION_NOT_FOUND, `Session "${id}" was not found`, {
      details: { sessionId: id },
    });
  }

  private async unpublishedSummary(
    id: string,
    sessionDir: string,
    workDir: string,
  ): Promise<SessionSummary> {
    const dirStat = await stat(sessionDir);
    const timestamp = timestampOrFallback(dirStat.birthtimeMs, dirStat.ctimeMs);
    return {
      id,
      workDir,
      sessionDir,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async trySummaryFromDir(
    id: string,
    sessionDir: string,
    workDir: string,
  ): Promise<SessionSummary | undefined> {
    try {
      return await this.summaryFromDir(id, sessionDir, workDir);
    } catch (error) {
      if (error instanceof PythinkerError && error.code === ErrorCodes.SESSION_STATE_INVALID) {
        return undefined;
      }
      throw error;
    }
  }

  private async summaryFromDir(
    id: string,
    sessionDir: string,
    workDir: string,
  ): Promise<SessionSummary> {
    const [dirStat, state, stateInfo, agentsWireMtime] = await Promise.all([
      stat(sessionDir),
      readSessionState(sessionDir, id),
      stat(join(sessionDir, 'state.json')),
      latestAgentWireMtime(sessionDir),
    ]);
    return {
      id,
      workDir,
      sessionDir,
      createdAt: timestampOrFallback(dirStat.birthtimeMs, dirStat.ctimeMs),
      updatedAt: Math.max(dirStat.mtimeMs, stateInfo.mtimeMs, agentsWireMtime ?? 0),
      archived: state.archived === true,
      title: state.title,
      lastPrompt: state.lastPrompt,
      metadata: state.custom as JsonObject,
    };
  }
}

async function readSessionState(sessionDir: string, id: string): Promise<SessionMeta> {
  try {
    return parseSessionMetadata(JSON.parse(await readFile(join(sessionDir, 'state.json'), 'utf-8')));
  } catch (error) {
    if (error instanceof PythinkerError && error.code === ErrorCodes.SESSION_STATE_INVALID) {
      throw error;
    }
    throw new PythinkerError(ErrorCodes.SESSION_STATE_INVALID, `Session "${id}" state.json is invalid`, {
      cause: error,
    });
  }
}

async function writeForkedState(
  input: ForkSessionRecordInput,
  source: SessionMeta,
  targetDir: string,
): Promise<SessionMeta> {
  const now = new Date().toISOString();
  const next = parseSessionMetadata({
    ...source,
    createdAt: now,
    updatedAt: now,
    title: normalizeForkTitle(input.title, source.title),
    isCustomTitle: input.title === undefined ? source.isCustomTitle : true,
    forkedFrom: input.sourceId,
    custom: forkCustomMetadata(source.custom, input.metadata),
  });
  await writeState(targetDir, next);
  return next;
}

async function writeState(sessionDir: string, state: SessionMeta): Promise<void> {
  await writeFile(join(sessionDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function forkCustomMetadata(source: unknown, metadata: JsonObject | undefined): Record<string, unknown> {
  return {
    ...customMetadataWithoutGoal(source),
    ...customMetadataWithoutGoal(metadata),
  };
}

async function dropForkedSessionFiles(sessionDir: string): Promise<void> {
  await Promise.all(
    FORKED_SESSION_DROPPED_FILES.map((fileName) => rm(join(sessionDir, fileName), { force: true })),
  );
}

async function appendForkedMarkers(sessionDir: string, state: SessionMeta): Promise<void> {
  const record: AgentRecordOf<'forked'> = { type: 'forked', time: Date.now() };
  await Promise.all(
    Object.keys(state.agents).map(async (agentId) => {
      const persistence = new FileSystemAgentRecordPersistence(
        join(sessionDir, 'agents', agentId, 'wire.jsonl'),
      );
      persistence.append(record);
      await persistence.flush();
    }),
  );
}

function customMetadataWithoutGoal(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const custom: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'goal') continue;
    custom[key] = entry;
  }
  return custom;
}

async function latestAgentWireMtime(sessionDir: string): Promise<number | undefined> {
  const agentsDir = join(sessionDir, 'agents');
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let latest = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wireInfo = await statIfExists(join(agentsDir, entry.name, 'wire.jsonl'));
    latest = Math.max(latest, wireInfo?.mtimeMs ?? 0);
  }
  return latest > 0 ? latest : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function statIfExists(path: string): Promise<{ readonly mtimeMs: number } | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function timestampOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeRequiredWorkDir(workDir: string): string {
  if (workDir.trim() === '') {
    throw new PythinkerError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, 'listSessions requires workDir');
  }
  return normalizeWorkDir(workDir);
}

function normalizeOptionalSessionId(sessionId: string | undefined): string | undefined {
  return sessionId === undefined ? undefined : sessionId.trim();
}

function normalizeForkTitle(title: string | undefined, fallback: string): string {
  if (title !== undefined) {
    const normalized = title.trim();
    if (normalized.length === 0) {
      throw new PythinkerError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    return normalized;
  }
  return fallback.trim().length > 0 ? fallback : 'New Session';
}

function assertSafeSessionId(id: string): void {
  if (isSafeSessionId(id)) return;
  throw new PythinkerError(ErrorCodes.SESSION_ID_INVALID, 'Session id contains unsupported path characters');
}

function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

function compareSessionSummary(a: SessionSummary, b: SessionSummary): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
