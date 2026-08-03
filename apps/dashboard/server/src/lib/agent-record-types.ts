// apps/dashboard/server/src/lib/agent-record-types.ts
// Single source of truth: everything below comes from agent-core directly.
// Do NOT add local interfaces that duplicate upstream shapes.

// Local binding for the `AgentRecord` type used by dashboard-only DTOs below.
import type { AgentRecord } from '@pythoughts/agent-core';

export type {
  AgentRecord,
  AgentRecordEvents,
  AgentRecordOf,
  AgentConfigUpdateData,
  CompactionBeginData,
  CompactionResult,
  PermissionApprovalResultRecord,
  PermissionMode,
  UsageRecordScope,
  ToolStoreUpdate,
  LoopRecordedEvent,
  ContextMessage,
  PromptOrigin,
} from '@pythoughts/agent-core';
export { AGENT_WIRE_PROTOCOL_VERSION } from '@pythoughts/agent-core';
export type { Message, ContentPart, ToolCall, TokenUsage } from '@pythoughts/kosong';

// ── dashboard-only DTOs ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code:
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'READ_ERROR'
    | 'PARSE_ERROR'
    | 'DELETE_ERROR'
    | 'INCOMPATIBLE_SESSION_STATE'
    | 'INCOMPATIBLE_AGENT_WIRE';
}

export type SessionHealth = 'ok' | 'missing_main_wire' | 'incompatible_state' | 'incompatible_wire';

export class DashboardIncompatibilityError extends Error {
  constructor(
    readonly kind: 'state' | 'wire',
    options?: ErrorOptions,
  ) {
    super(kind === 'state' ? 'session state is incompatible' : 'agent wire is incompatible', options);
    this.name = 'DashboardIncompatibilityError';
  }
}

export function dashboardIncompatibilityBody(error: unknown): ApiError | null {
  if (!(error instanceof DashboardIncompatibilityError)) return null;
  return error.kind === 'state'
    ? { error: 'session state is incompatible', code: 'INCOMPATIBLE_SESSION_STATE' }
    : { error: 'agent wire is incompatible', code: 'INCOMPATIBLE_AGENT_WIRE' };
}

export interface SessionSummary {
  sessionId: string;
  sessionDir: string;
  workDir: string;
  title: string | null;
  lastPrompt: string | null;
  isCustomTitle: boolean;
  createdAt: number;
  updatedAt: number;
  agentCount: number;
  mainAgentExists: boolean;
  mainWireRecordCount: number;
  wireProtocolVersion: string | null;
  health: SessionHealth;
}

export interface AgentInfo {
  agentId: string;
  type: 'main' | 'sub' | 'independent';
  parentAgentId: string | null;
  wireExists: boolean;
  wireRecordCount: number;
  wireProtocolVersion: string | null;
  dynamicWorkflowItem: string | null;
}

export interface SessionDetail {
  sessionId: string;
  /** Canonical on-disk session directory. */
  sessionDir: string;
  workDir: string;
  state: unknown; // Pass through as-is; the frontend renders according to the real state.json shape
  agents: AgentInfo[];
}

/** One line of `wire.jsonl`. `lineNo` is internal plumbing — used as a stable React key, for
 *  "jump to line" navigation, and for pairing events — and MUST NOT be
 *  rendered as part of the record body. The detail panel surfaces it via
 *  the row header, not inside the JSON view. */
export interface WireEntry {
  /** 1-indexed line number in the underlying `wire.jsonl` file. */
  lineNo: number;
  /** The validated current-protocol record used by dashboard renderers. */
  data: AgentRecord;
  /** The record exactly as written on disk, exposed only by the raw-record view. */
  raw: unknown;
}

export interface WireResponse {
  sessionId: string;
  agentId: string;
  protocolVersion: string;
  metadata: { protocolVersion: string; createdAt: number };
  records: readonly WireEntry[];
}

export interface AgentNode extends AgentInfo {
  children: AgentNode[];
}

export interface AgentTreeResponse {
  sessionId: string;
  tree: AgentNode[];
}
