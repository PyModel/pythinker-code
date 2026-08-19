/**
 * Integer namespaces:
 *   - 0          success
 *   - 4xxxx      client errors (HTTP-4xx analog)
 *   - 5xxxx      daemon internal errors
 *   - 6xxxx      tool runtime errors
 *   - 7xxxx      LLM provider passthrough (msg = original upstream text)
 *   - 8xxxx      MCP server passthrough (msg = original upstream text)
 *   - 9xxxx      reserved
 */

export const ErrorCode = {
  /** Success. */
  SUCCESS: 0,

  /** Zod validation failed; `details` contains field paths. */
  VALIDATION_FAILED: 40001,
  /** JSON parsing failed or a field has the wrong type. */
  REQUEST_MALFORMED: 40002,

  /** The daemon has no provider configuration. */
  AUTH_PROVISIONING_REQUIRED: 40110,
  /** The provider exists, but its token or API key is missing. */
  AUTH_TOKEN_MISSING: 40111,
  /** Token refresh returned 401 because the user revoked access. */
  AUTH_TOKEN_UNAUTHORIZED: 40112,
  /** The default or requested model does not resolve to a provider. */
  AUTH_MODEL_NOT_RESOLVED: 40113,

  /** The session ID does not exist. */
  SESSION_NOT_FOUND: 40401,
  /** The prompt ID does not exist. */
  PROMPT_NOT_FOUND: 40402,
  /** The message ID does not exist. */
  MESSAGE_NOT_FOUND: 40403,
  /** The approval ID does not exist. */
  APPROVAL_NOT_FOUND: 40404,
  /** The question ID does not exist. */
  QUESTION_NOT_FOUND: 40405,
  /** The task ID does not exist. */
  TASK_NOT_FOUND: 40406,
  /** The file ID does not exist. */
  FILE_NOT_FOUND: 40407,
  /** The MCP server ID does not exist. */
  MCP_SERVER_NOT_FOUND: 40408,
  /** The file-system path does not exist. */
  FS_PATH_NOT_FOUND: 40409,
  /** The workspace ID does not exist. */
  WORKSPACE_NOT_FOUND: 40410,
  /** The path exists, but the process cannot read it. */
  FS_PERMISSION_DENIED: 40411,
  /** The provider ID does not exist. */
  PROVIDER_NOT_FOUND: 40412,
  /** The model ID does not exist. */
  MODEL_NOT_FOUND: 40413,
  /** The terminal ID does not exist. */
  TERMINAL_NOT_FOUND: 40414,
  /** The skill name does not exist. */
  SKILL_NOT_FOUND: 40415,
  /** The tool-call ID does not exist or has no matching plan. */
  TOOL_CALL_NOT_FOUND: 40416,

  /** The session has an active prompt and rejects the new request. */
  SESSION_BUSY: 40901,
  /** Another client already answered the approval. */
  APPROVAL_ALREADY_RESOLVED: 40902,
  /** The prompt already ended; abort remains idempotent. */
  PROMPT_ALREADY_COMPLETED: 40903,
  /** The task already ended and cannot be cancelled. */
  TASK_ALREADY_FINISHED: 40904,
  /** MCP restart was requested while already connecting or connected. */
  MCP_ALREADY_CONNECTED: 40905,
  /** File read was requested for a directory. */
  FS_IS_DIRECTORY: 40906,
  /** UTF-8 read was requested for a binary path; use `:download`. */
  FS_IS_BINARY: 40907,
  /** Git status was requested outside a Git repository. */
  FS_GIT_UNAVAILABLE: 40908,
  /** The user dismissed the complete question group. */
  QUESTION_DISMISSED: 40909,
  /** The current history has no prefix that can be compacted. */
  COMPACTION_UNABLE: 40910,
  /** The current history has too few user prompts to undo. */
  SESSION_UNDO_UNAVAILABLE: 40911,
  /** The skill exists, but its type does not permit user activation. */
  SKILL_NOT_ACTIVATABLE: 40912,

  /** The current session already has an active goal. */
  GOAL_ALREADY_EXISTS: 40913,
  /** The goal does not exist. */
  GOAL_NOT_FOUND: 40914,
  /** The goal state does not permit this operation. */
  GOAL_STATUS_INVALID: 40915,
  /** The current goal state cannot be resumed. */
  GOAL_NOT_RESUMABLE: 40916,
  /** The goal objective is empty. */
  GOAL_OBJECTIVE_EMPTY: 40917,
  /** The goal objective exceeds the length limit. */
  GOAL_OBJECTIVE_TOO_LONG: 40918,
  /** The mkdir target already exists. */
  FS_ALREADY_EXISTS: 40919,
  /** Only the main agent can use goals. */
  GOAL_UNSUPPORTED_AGENT: 40920,
  /** The prompt ID is already present in this agent's history. */
  PROMPT_ID_CONFLICT: 40927,

  /** The approval expired after 60 seconds. */
  APPROVAL_EXPIRED: 41001,
  /** The question expired after 60 seconds. */
  QUESTION_EXPIRED: 41002,
  /** The temporary file expired. */
  FILE_EXPIRED: 41003,

  /** The file is too large. */
  FILE_TOO_LARGE: 41301,
  /** The file read exceeds 10 MB. */
  FS_TOO_LARGE: 41302,
  /** File listing, search, or grep exceeded its result limit. */
  FS_TOO_MANY_RESULTS: 41303,
  /** The path escapes the session working-directory boundary. */
  FS_PATH_ESCAPES_SESSION: 41304,
  /** File grep exceeded 30 seconds. */
  FS_GREP_TIMEOUT: 41305,

  /** One WebSocket connection requested more than 100 watch paths. */
  FS_WATCH_LIMIT_EXCEEDED: 42902,

  /** Unclassified internal error. */
  INTERNAL_ERROR: 50001,
  /** Writing persistent session state failed. */
  PERSISTENCE_FAILURE: 50003,

  /** Tool execution threw an error. */
  TOOL_EXECUTION_FAILED: 60001,
  /** The tool is not enabled for this session. */
  TOOL_NOT_AVAILABLE: 60002,

  /** provider.* preserves the provider code and upstream message text. */
  /** mcp.* preserves the MCP server code and upstream message text. */
} as const;

/**
 * Reserved (intentionally unallocated; do NOT reuse for new variants):
 *   - 40101 auth.invalid_token        (daemon's own token; future)
 *   - 40102 auth.missing_token        (daemon's own token; future)
 *   - 40103 auth.forbidden_origin     (daemon's own token; future)
 *   - 42901 rate.limited
 *   - 50002 protocol.version_mismatch
 */

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCodeReason: Readonly<Record<ErrorCode, string>> = {
  [ErrorCode.SUCCESS]: 'success',

  [ErrorCode.VALIDATION_FAILED]: 'validation.failed',
  [ErrorCode.REQUEST_MALFORMED]: 'request.malformed',

  [ErrorCode.AUTH_PROVISIONING_REQUIRED]: 'auth.provisioning_required',
  [ErrorCode.AUTH_TOKEN_MISSING]: 'auth.token_missing',
  [ErrorCode.AUTH_TOKEN_UNAUTHORIZED]: 'auth.token_unauthorized',
  [ErrorCode.AUTH_MODEL_NOT_RESOLVED]: 'auth.model_not_resolved',

  [ErrorCode.SESSION_NOT_FOUND]: 'session.not_found',
  [ErrorCode.PROMPT_NOT_FOUND]: 'prompt.not_found',
  [ErrorCode.MESSAGE_NOT_FOUND]: 'message.not_found',
  [ErrorCode.APPROVAL_NOT_FOUND]: 'approval.not_found',
  [ErrorCode.QUESTION_NOT_FOUND]: 'question.not_found',
  [ErrorCode.TASK_NOT_FOUND]: 'task.not_found',
  [ErrorCode.FILE_NOT_FOUND]: 'file.not_found',
  [ErrorCode.MCP_SERVER_NOT_FOUND]: 'mcp.server_not_found',
  [ErrorCode.FS_PATH_NOT_FOUND]: 'fs.path_not_found',
  [ErrorCode.WORKSPACE_NOT_FOUND]: 'workspace.not_found',
  [ErrorCode.FS_PERMISSION_DENIED]: 'fs.permission_denied',
  [ErrorCode.PROVIDER_NOT_FOUND]: 'provider.not_found',
  [ErrorCode.MODEL_NOT_FOUND]: 'model.not_found',
  [ErrorCode.TERMINAL_NOT_FOUND]: 'terminal.not_found',
  [ErrorCode.SKILL_NOT_FOUND]: 'skill.not_found',
  [ErrorCode.TOOL_CALL_NOT_FOUND]: 'tool_call.not_found',

  [ErrorCode.SESSION_BUSY]: 'session.busy',
  [ErrorCode.APPROVAL_ALREADY_RESOLVED]: 'approval.already_resolved',
  [ErrorCode.PROMPT_ALREADY_COMPLETED]: 'prompt.already_completed',
  [ErrorCode.TASK_ALREADY_FINISHED]: 'task.already_finished',
  [ErrorCode.MCP_ALREADY_CONNECTED]: 'mcp.already_connected',
  [ErrorCode.FS_IS_DIRECTORY]: 'fs.is_directory',
  [ErrorCode.FS_IS_BINARY]: 'fs.is_binary',
  [ErrorCode.FS_GIT_UNAVAILABLE]: 'fs.git_unavailable',
  [ErrorCode.QUESTION_DISMISSED]: 'question.dismissed',
  [ErrorCode.COMPACTION_UNABLE]: 'compaction.unable',
  [ErrorCode.SESSION_UNDO_UNAVAILABLE]: 'session.undo_unavailable',
  [ErrorCode.SKILL_NOT_ACTIVATABLE]: 'skill.not_activatable',

  [ErrorCode.GOAL_ALREADY_EXISTS]: 'goal.already_exists',
  [ErrorCode.GOAL_NOT_FOUND]: 'goal.not_found',
  [ErrorCode.GOAL_STATUS_INVALID]: 'goal.status_invalid',
  [ErrorCode.GOAL_NOT_RESUMABLE]: 'goal.not_resumable',
  [ErrorCode.GOAL_OBJECTIVE_EMPTY]: 'goal.objective_empty',
  [ErrorCode.GOAL_OBJECTIVE_TOO_LONG]: 'goal.objective_too_long',
  [ErrorCode.FS_ALREADY_EXISTS]: 'fs.already_exists',
  [ErrorCode.GOAL_UNSUPPORTED_AGENT]: 'goal.unsupported_agent',
  [ErrorCode.PROMPT_ID_CONFLICT]: 'prompt.id_conflict',

  [ErrorCode.APPROVAL_EXPIRED]: 'approval.expired',
  [ErrorCode.QUESTION_EXPIRED]: 'question.expired',
  [ErrorCode.FILE_EXPIRED]: 'file.expired',

  [ErrorCode.FILE_TOO_LARGE]: 'file.too_large',
  [ErrorCode.FS_TOO_LARGE]: 'fs.too_large',
  [ErrorCode.FS_TOO_MANY_RESULTS]: 'fs.too_many_results',
  [ErrorCode.FS_PATH_ESCAPES_SESSION]: 'fs.path_escapes_session',
  [ErrorCode.FS_GREP_TIMEOUT]: 'fs.grep_timeout',

  [ErrorCode.FS_WATCH_LIMIT_EXCEEDED]: 'fs.watch_limit_exceeded',

  [ErrorCode.INTERNAL_ERROR]: 'internal.error',
  [ErrorCode.PERSISTENCE_FAILURE]: 'persistence.failure',

  [ErrorCode.TOOL_EXECUTION_FAILED]: 'tool.execution_failed',
  [ErrorCode.TOOL_NOT_AVAILABLE]: 'tool.not_available',
};
