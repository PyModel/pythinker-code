import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { parseSessionMetadata, type SessionMeta } from '@pymodel/agent-core';

import {
  DashboardIncompatibilityError,
  type AgentInfo,
  type SessionDetail,
  type SessionSummary,
} from './agent-record-types';
import { compareAgentIds } from './agent-tree';
import { readAgentWire } from './wire-reader';

const SESSION_ID_RE = /^session_[A-Za-z0-9._-]+$/;
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;

export function isSafeAgentId(id: string): boolean {
  return AGENT_ID_RE.test(id) && id !== '.' && id !== '..';
}

export async function listSessions(home: string): Promise<SessionSummary[]> {
  const sessionsDir = join(home, 'sessions');
  const buckets = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const index = await readSessionIndex(home);
  const out: SessionSummary[] = [];
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    const bucketDir = join(sessionsDir, bucket.name);
    const sessionDirs = await readdir(bucketDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionDirs) {
      if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue;
      const sessionDir = join(bucketDir, entry.name);
      const workDir = index.get(entry.name)?.workDir ?? '';
      const summary = await tryReadSummary(sessionDir, entry.name, workDir);
      if (summary !== null) out.push(summary);
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function readSessionDetail(home: string, sessionId: string): Promise<SessionDetail | null> {
  const sessionDir = await findSessionDir(home, sessionId);
  if (sessionDir === null) return null;
  const index = await readSessionIndex(home);
  const workDir = index.get(sessionId)?.workDir ?? '';
  const state = await readState(sessionDir);
  const agents = await inventoryAgents(sessionDir, state);
  return { sessionId, sessionDir, workDir, state, agents };
}

async function tryReadSummary(
  sessionDir: string,
  sessionId: string,
  workDir: string,
): Promise<SessionSummary | null> {
  let state: SessionMeta;
  try {
    state = await readState(sessionDir);
  } catch (error) {
    if (error instanceof DashboardIncompatibilityError && error.kind === 'state') {
      return incompatibleStateSummary(sessionDir, sessionId, workDir);
    }
    throw error;
  }
  try {
    const agents = await inventoryAgents(sessionDir, state);
    const main = agents.find((agent) => agent.agentId === 'main');
    return {
      sessionId,
      sessionDir,
      workDir,
      title: state.title,
      lastPrompt: state.lastPrompt ?? null,
      isCustomTitle: state.isCustomTitle,
      createdAt: parseTs(state.createdAt),
      updatedAt: parseTs(state.updatedAt),
      agentCount: agents.length,
      mainAgentExists: main !== undefined,
      mainWireRecordCount: main?.wireRecordCount ?? 0,
      wireProtocolVersion: main?.wireProtocolVersion ?? null,
      health: main === undefined || !main.wireExists ? 'missing_main_wire' : 'ok',
    };
  } catch (error) {
    if (error instanceof DashboardIncompatibilityError && error.kind === 'wire') {
      return incompatibleWireSummary(sessionDir, sessionId, workDir, state);
    }
    throw error;
  }
}

function incompatibleStateSummary(
  sessionDir: string,
  sessionId: string,
  workDir: string,
): SessionSummary {
  return {
    sessionId,
    sessionDir,
    workDir,
    title: null,
    lastPrompt: null,
    isCustomTitle: false,
    createdAt: 0,
    updatedAt: 0,
    agentCount: 0,
    mainAgentExists: false,
    mainWireRecordCount: 0,
    wireProtocolVersion: null,
    health: 'incompatible_state',
  };
}

function incompatibleWireSummary(
  sessionDir: string,
  sessionId: string,
  workDir: string,
  state: SessionMeta,
): SessionSummary {
  return {
    sessionId,
    sessionDir,
    workDir,
    title: state.title,
    lastPrompt: state.lastPrompt ?? null,
    isCustomTitle: state.isCustomTitle,
    createdAt: parseTs(state.createdAt),
    updatedAt: parseTs(state.updatedAt),
    agentCount: Object.keys(state.agents).length,
    mainAgentExists: Object.hasOwn(state.agents, 'main'),
    mainWireRecordCount: 0,
    wireProtocolVersion: null,
    health: 'incompatible_wire',
  };
}

interface SessionIndexEntry {
  sessionDir: string;
  workDir: string;
}

async function readSessionIndex(home: string): Promise<Map<string, SessionIndexEntry>> {
  const out = new Map<string, SessionIndexEntry>();
  let raw: string;
  try {
    raw = await readFile(join(home, 'session_index.jsonl'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { sessionId?: string; sessionDir?: string; workDir?: string };
      if (typeof entry.sessionId === 'string' && typeof entry.sessionDir === 'string') {
        out.set(entry.sessionId, {
          sessionDir: entry.sessionDir,
          workDir: typeof entry.workDir === 'string' ? entry.workDir : '',
        });
      }
    } catch {
      // Ignore malformed index entries and fall back to directory scanning.
    }
  }
  return out;
}

async function inventoryAgents(sessionDir: string, state: SessionMeta): Promise<AgentInfo[]> {
  const result: AgentInfo[] = [];
  for (const [agentId, meta] of Object.entries(state.agents)) {
    if (!isSafeAgentId(agentId)) {
      throw new DashboardIncompatibilityError('state');
    }
    const wirePath = join(sessionDir, 'agents', agentId, 'wire.jsonl');
    if (!(await pathExists(wirePath))) {
      result.push({
        agentId,
        type: meta.type,
        parentAgentId: meta.parentAgentId,
        wireExists: false,
        wireRecordCount: 0,
        wireProtocolVersion: null,
        dynamicWorkflowItem: meta.dynamicWorkflowItem ?? null,
      });
      continue;
    }
    const info = await scanWire(wirePath);
    result.push({
      agentId,
      type: meta.type,
      parentAgentId: meta.parentAgentId,
      wireExists: true,
      wireRecordCount: info.count,
      wireProtocolVersion: info.protocolVersion,
      dynamicWorkflowItem: meta.dynamicWorkflowItem ?? null,
    });
  }
  return result.toSorted((a, b) => compareAgentIds(a.agentId, b.agentId));
}

async function readState(sessionDir: string): Promise<SessionMeta> {
  try {
    return parseSessionMetadata(JSON.parse(await readFile(join(sessionDir, 'state.json'), 'utf8')));
  } catch (error) {
    if (error instanceof DashboardIncompatibilityError) throw error;
    throw new DashboardIncompatibilityError('state', { cause: error });
  }
}

async function findSessionDir(home: string, sessionId: string): Promise<string | null> {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const sessionsRoot = resolve(join(home, 'sessions'));
  const sessionsRootPrefix = sessionsRoot + sep;
  try {
    const indexLines = (await readFile(join(home, 'session_index.jsonl'), 'utf8')).split(/\r?\n/);
    for (const line of indexLines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as { sessionId?: string; sessionDir?: string };
      if (entry.sessionId !== sessionId || typeof entry.sessionDir !== 'string') continue;
      const candidate = resolve(entry.sessionDir);
      if (!candidate.startsWith(sessionsRootPrefix)) continue;
      if (candidate.split(sep).pop() !== sessionId) continue;
      if (await pathExists(candidate)) return candidate;
    }
  } catch {
    // No usable index; scan the session buckets below.
  }
  const buckets = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    const candidate = join(sessionsRoot, bucket.name, sessionId);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function scanWire(path: string): Promise<{ count: number; protocolVersion: string }> {
  const wire = await readAgentWire(path);
  return {
    count: wire.records.length + 1,
    protocolVersion: wire.metadata.protocolVersion,
  };
}

function parseTs(input: string): number {
  const value = Date.parse(input);
  return Number.isFinite(value) ? value : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
