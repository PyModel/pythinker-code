import type { RunResult, StreamEvent } from "./legacy-sdk";

export interface SessionConfig {
  model: string;
  thinking?: boolean;
  effort?: string;
  /**
   * Whether the user explicitly changed the effort. Re-confirming the effort
   * already shown is not an explicit choice: the model is persisted but the
   * stored effort preference is left alone (mirrors the TUI's
   * persistModelSelection). Treated as true when omitted.
   */
  effortChanged?: boolean;
}

export interface ProjectFile {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted";
  additions: number;
  deletions: number;
}

export interface ExtensionConfig {
  yoloMode: boolean;
  autosave: boolean;
  useCtrlEnterToSend: boolean;
  enableNewConversationShortcut: boolean;
  showThinkingContent: boolean;
  showThinkingExpanded: boolean;
  version: string;
}

export interface WorkspaceStatus {
  hasWorkspace: boolean;
  path?: string;
  workspaceRoot?: string;
}

export type ErrorPhase = "preflight" | "runtime";

export interface StreamError {
  type: "error";
  code: string;
  message: string;
  detail?: string; // Original server error message
  phase: ErrorPhase;
  /**
   * `false` marks a mid-turn warning: the turn is still running, so UIs must
   * not treat it as turn-ending. Do not unlock the composer, offer Retry, or
   * flush the queued messages for non-terminal errors.
   */
  terminal?: boolean;
}

export type UIStreamEvent =
  | { type: "session_start"; sessionId: string; model?: string; _sessionId?: string }
  | { type: "stream_complete"; result: RunResult; _sessionId?: string }
  | (StreamError & { _sessionId?: string })
  | (StreamEvent & { _sessionId?: string });

export interface LoginStatus {
  loggedIn: boolean;
}

export type { QuestionRequest, QuestionItem, QuestionOption, QuestionResponse } from "./legacy-sdk";

/** A provider as it exists in config.toml. The API key itself never crosses the bridge. */
export interface ConfiguredProvider {
  id: string;
  type: string;
  baseUrl?: string;
  keySource: "config" | "env" | "oauth" | "none";
  /** Host of the provider's base URL, shown so a managed provider is identifiable. */
  host?: string;
  apiKeyEnvVar?: string;
  catalogUrl?: string;
  models: string[];
}

export interface ProvidersView {
  providers: ConfiguredProvider[];
  defaultModel: string | null;
}

export interface CatalogModelSummary {
  id: string;
  name: string;
  maxContextTokens?: number;
  thinking: boolean;
}

export interface CatalogProviderSummary {
  id: string;
  name: string;
  wire?: string;
  apiKeyEnvVar?: string;
  models: CatalogModelSummary[];
}

export interface AddCatalogProviderRequest {
  providerId: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  defaultModel?: string;
}
