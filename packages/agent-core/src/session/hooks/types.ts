import type { ContentPart } from '@pythoughts/kosong';

export const HOOK_EVENT_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionResult',
  'PermissionDenied',
  'Setup',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Interrupt',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'ConfigChange',
  'Elicitation',
  'ElicitationResult',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'Notification',
] as const;

export type HookEventType = (typeof HOOK_EVENT_TYPES)[number];

interface HookDefBase {
  readonly event: HookEventType;
  readonly matcher?: string;
  readonly if?: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
  readonly once?: boolean;
  readonly async?: boolean;
}

export interface CommandHookDef extends HookDefBase {
  readonly type?: 'command';
  readonly command: string;
  readonly asyncRewake?: boolean;
  readonly shell?: 'bash' | 'powershell';
}

export interface HttpHookDef extends HookDefBase {
  readonly type: 'http';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly allowedEnvVars?: readonly string[];
}

export interface ModelHookDef extends HookDefBase {
  readonly type: 'prompt' | 'agent';
  readonly prompt: string;
  readonly model?: string;
}

export type HookDef = CommandHookDef | HttpHookDef | ModelHookDef;

export interface ElicitationHookResponse {
  readonly action: 'accept' | 'decline' | 'cancel';
  readonly content?: Readonly<Record<string, string | number | boolean | string[]>>;
}

export interface HookResult {
  readonly action: 'allow' | 'block';
  readonly message?: string;
  readonly retry?: boolean;
  readonly watchPaths?: readonly string[];
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly structuredOutput?: boolean;
  readonly elicitationResponse?: ElicitationHookResponse;
}

export interface HookBlockDecision {
  readonly block: true;
  readonly reason: string;
}

export type HookMatcherValue = string | readonly ContentPart[];

export interface HookEngineTriggerArgs {
  readonly matcherValue?: HookMatcherValue;
  readonly inputData?: Record<string, unknown>;
  readonly signal?: AbortSignal;
  readonly ifMatcher?: (condition: string) => boolean;
}

export type HookTriggeredCallback = (event: string, target: string, count: number) => void;

export type HookResolvedCallback = (
  event: string,
  target: string,
  action: string,
  reason: string | undefined,
  durationMs: number,
) => void;

export type AsyncHookRewakeCallback = (
  event: string,
  results: readonly HookResult[],
) => void | Promise<void>;

export type HookStatusCallback = (
  event: string,
  statusId: string,
  content: string,
  active: boolean,
  agentId?: string,
) => void;

export type HookWatchPathsCallback = (
  event: string,
  paths: readonly string[],
) => void | Promise<void>;

export type ModelHookRunner = (
  hook: ModelHookDef,
  event: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<HookResult>;

export interface HookEngineOptions {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly allowedHttpHookUrls?: readonly string[];
  readonly httpHookAllowedEnvVars?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly onTriggered?: HookTriggeredCallback;
  readonly onResolved?: HookResolvedCallback;
  readonly onAsyncRewake?: AsyncHookRewakeCallback;
  readonly onStatus?: HookStatusCallback;
  readonly onWatchPaths?: HookWatchPathsCallback;
  readonly onCwdChanged?: (cwd: string) => void | Promise<void>;
  readonly runModelHook?: ModelHookRunner;
}
