# Transcript SDK

This document describes the **current implementation** of the transcript package's external contract. Readers are consumers of the transcript channel (the Pythinker Code app, pythinker-inspect, external REST/WS clients) and maintainers of the transcript package. The authoritative definition of the contract is the zod schema in `src/contract/schema.ts`; this document is its readable form. Where the two disagree, the schema wins and this document must be corrected. Contract changes must ship with a migration document (see section 8).

## 1. Positioning and layers

transcript is the read channel for a session's conversation timeline. The same data is fed two ways:

- **live**: agent-gateway subscribes to core's observable events (`IEventBus`); a projector translates them into ops written to the in-memory store.
- **cold**: the timeline is rebuilt from the durable records in `wire.jsonl` through a two-level fold (`history/groupTurns.ts` folds context messages into the turn tree; `history/foldFacts.ts` folds non-context records into entities and meta).

`wire.jsonl` is the single source of truth for history; the live store is purely in-memory state that dies with the session. The cold rebuild has declared field gaps (see 2.8, known limitations).

```text
TranscriptStore (per session)
└── agents: Map<AgentId, AgentTranscript> + roster: AgentDescriptor[]
    └── AgentState
        ├── items: (Turn | Marker | TaskRef)[]     timeline; Turn embeds steps[], Step embeds frames[]
        ├── tasks / interactions / attachments / todos / prompts   global entities
        ├── meta (goal / modes / activity / agent)
        └── hasMoreOlder
```

ID convention: turn `t{N}` (ordinal starting at 0, matching the engine), step `t{N}.{M}`, text/thinking frame `t{N}.{M}.f{K}`, tool frame `t{N}.{M}.{toolCallId}`. Marker ids are `live-m{N}` on the live path and `m{N}` on the cold path.

## 2. Data model

### 2.1 AgentDescriptor

```ts
interface AgentDescriptor {
  agentId: AgentId;
  type?: 'main' | 'sub' | 'independent';
  parentAgentId?: AgentId;
  label?: string;
  createdAt?: string;
  disposedAt?: string;
}
```

The current write path only distinguishes `agentId === 'main'`: main writes `'main'`, everything else writes `'sub'` (`packages/agent-core-v2/src/session/agentLifecycle/agentLifecycleService.ts:266`). Nothing writes `'independent'`. As a result, sidebar agents and subagents cannot be told apart from metadata alone (both register as `'sub'` with `parentAgentId: 'main'`; the only difference is the presence or absence of a label).

### 2.2 Turn / Step

```ts
interface Turn {
  kind: 'turn';
  turnId: TurnId;
  triggerPromptId?: string;
  ordinal: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  origin: TurnOrigin;                 // { kind: 'user'|'cron'|'task'|'hook'|'compaction'|'side'|'other', taskId?, payload? }
  prompt?: string;
  attachmentIds?: AttachmentId[];
  steps: Step[];
  startedAt?: string;
  endedAt?: string;
  usage?: Usage;                      // { inputTokens?, outputTokens?, cachedTokens?, cost? }
  durationMs?: number;
  error?: string;
}

interface Step {
  kind: 'step';
  stepId: StepId;
  turnId: TurnId;
  ordinal: number;
  state: 'running' | 'completed' | 'interrupted' | 'failed';
  frames: Frame[];
  startedAt?: string;
  endedAt?: string;
  usage?: StepUsage;                  // { inputOther, output, inputCacheRead, inputCacheCreation }
  finishReason?: string;
  timing?: StepTiming;                // llmFirstTokenLatencyMs / llmStreamDurationMs / llmRequestBuildMs / llmServerFirstTokenMs / llmServerDecodeMs / llmClientConsumeMs
  retry?: StepRetry;                  // { failedAttempt, nextAttempt, maxAttempts, delayMs, errorName, errorMessage, statusCode? }
  endReason?: string;
  endMessage?: string;
}
```

The actual state machine is smaller than the declared enum: Turn actually only goes `running → completed | failed | cancelled` (nothing writes `'queued'`); Step actually only goes `running → completed | interrupted` (nothing writes `'failed'`). Core's `TurnEndReason` has 4 values (including `'blocked'`); when projected into transcript, `'blocked'` collapses into `'failed'`.

### 2.3 Frame

```ts
type Frame = TextFrame | ThinkingFrame | ToolCallFrame | NoticeFrame;
```

- `TextFrame`: `{ kind: 'text', frameId, role: 'assistant'|'user', text, attachmentIds?, taskId?, promptIds?, origin? }` (a user frame's `origin` may carry `skillActivations`)
- `ThinkingFrame`: `{ kind: 'thinking', frameId, text }`
- `ToolCallFrame`: `{ kind: 'tool', frameId, toolCallId, name, state: 'running'|'done'|'error', view?, input?, output?, display?, error?, inputText?, progress?, taskId?, approvalId?, todoId?, agentRefs? }`
- `NoticeFrame`: `{ kind: 'notice', frameId, level: 'error'|'warning'|'info', source?, message, detail? }`

### 2.4 Marker / TaskRef / Task / Interaction / Todo / Attachment

```ts
interface Marker {
  kind: 'marker';
  markerId: string;
  marker: string;                     // KNOWN_MARKERS below
  payload?: unknown;
  at?: string;
}
```

`KNOWN_MARKERS` (`packages/transcript/src/model/item.ts`): `'compaction' | 'undo' | 'clear' | 'goal' | 'plan.enter' | 'plan.exit' | 'plan.revision' | 'dynamic_workflow.enter' | 'dynamic_workflow.exit' | 'skill' | 'cron.fired' | 'notice' | 'hook'` (the `marker` field itself is typed as a free-form string; `KNOWN_MARKERS` is only the list of currently known keys).

```ts
interface TaskRef { kind: 'taskref'; refId: string; taskId: TaskId; at?: string }

interface Task {
  taskId: TaskId;
  kind: 'shell' | 'subagent' | 'tool' | 'other';   // nothing writes 'tool'
  state: 'running' | 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost';
  detached: boolean;
  description?: string;
  agentId?: AgentId;
  outputTail: string;
  startedAt?: string;
  endedAt?: string;
  resultSummary?: string;
  error?: string;
  stateReason?: string;
  usage?: StepUsage;
  model?: string;
  thinkingEffort?: string;
}

interface Interaction {
  interactionId: InteractionId;
  interactionKind: 'approval' | 'question';
  toolCallId?: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'answered' | 'dismissed';
  request?: unknown;
  response?: unknown;
}
```

### 2.5 Prompt

```ts
interface Prompt {
  promptId: PromptId;
  status: 'running' | 'queued' | 'blocked' | 'completed' | 'failed' | 'aborted';
  userMessageId?: string;
  content?: unknown;
  createdAt: string;
  finishedAt?: string;
  steeredAt?: string;
}
```

The prompt entity is only written on the live path (the cold rebuild does not build a `prompts` list). `'blocked'` means the turn was intercepted by an external hook before starting; a sub-prompt absorbed by steering is recorded as `'completed'` with `steeredAt` set.

### 2.6 Meta

```ts
interface TranscriptMeta {
  goal?: { objective: string; status: 'active'|'paused'|'blocked'|'complete'; completionCriterion?; budgetUsed?; budgetLimit? };
  modes?: { plan?: { reviewPath?, version? }; dynamic_workflow?: { trigger? }; tower?: {} };
  activity?: 'idle' | 'turn' | 'disposing' | 'unknown';   // only 'idle'/'turn' are actually written
  agent?: AgentStatusMeta;
}

interface AgentStatusMeta {
  model?: string;
  thinkingEffort?: string;
  usage?: { byModel?: Record<string, StepUsage>; currentTurn?: StepUsage; total?: StepUsage };
  contextTokens?: number;
  maxContextTokens?: number;
  contextUsage?: number;
  permission?: 'manual' | 'yolo' | 'auto';
  phase?: AgentPhaseMeta;
}
```

`AgentPhaseMeta` has 8 kinds: `idle | running | streaming | tool_call | retrying | awaiting_approval | interrupted | ended`, mapped from core's `AgentActivityState` by agent-gateway's `toLegacyPhase` and delivered through `meta.merge`; the cold path never backfills it. `AgentStatusMeta.permission` and `contextUsage` currently have no writer (the schema declares them for forward compatibility).

### 2.7 Snapshot

```ts
interface AgentTranscriptSnapshot {
  items: TranscriptItem[];
  tasks: Task[];
  interactions: Interaction[];
  attachments: Attachment[];
  todos: Todo[];
  prompts: Prompt[];
  meta: TranscriptMeta;
  hasMoreOlder?: boolean;
}
```

### 2.8 Known limitations (cold rebuild gaps)

- `step.retry` is not backfilled (retry events have been written to wire since #3428, but the fold does not yet consume them; transient by design).
- `step.usage` / `timing` / `finishReason`, `turn.usage`, `meta.agent.*`, `agent.phase`, and the `prompts` list are not backfilled.
- Step interruption information (`state: 'interrupted'` plus `endReason` / `endMessage` / `endedAt`) has been backfilled from the durable `turn.step.interrupted` record since #3428 (a matching step is synthesized when the context tree lacks one).
- A turn missing a `turn.ended` record (interrupted by a process crash) is always marked `'completed'` on the cold path.
- The live and cold paths use different id namespaces for the same logical marker (`live-m{N}` vs `m{N}`).

## 3. Operations (ops)

All store changes are applied as an op batch. The op union has 14 members:

| op | payload | semantics |
|---|---|---|
| `reset` | `{ agentId, snapshot }` | replace the whole AgentState; the server never produces this — only client stores/tests use it (the server-side reset exists as a dedicated frame) |
| `turn.upsert` | `{ turn: TurnHeader }` | upsert a turn header, preserving existing steps |
| `step.upsert` | `{ turnId, step: StepHeader }` | upsert a step header, preserving existing frames |
| `frame.upsert` | `{ turnId, stepId, frame }` | replace a whole frame |
| `append` | `{ target, offset, text }` | append to a text/thinking frame or to `task.outputTail`; idempotency key is `(target, offset)`, overlapping ranges are merged, a gap rejects the whole batch |
| `marker.upsert` | `{ item, beforeTurn? }` | timeline marker |
| `taskref.upsert` | `{ item, beforeTurn? }` | timeline task reference |
| `task.upsert` | `{ task }` | task entity |
| `interaction.upsert` | `{ interaction }` | interaction entity; also keeps `pendingInteractions` in sync |
| `attachment.upsert` | `{ attachment }` | attachment entity |
| `todo.upsert` | `{ todo }` | todo entity |
| `prompt.upsert` | `{ prompt }` | prompt entity (live-only) |
| `meta.merge` | `{ meta }` | deep-merge into meta; `null` on a key deletes it |
| `items.remove` | `{ ids }` | remove timeline entries, cascading to any interaction anchored on them |

Rules:

1. **Idempotency**: upserts compare fields for equality; an op with no change is dropped and does not notify subscribers; replaying a whole batch is a no-op.
2. **Sequencing**: the server assigns each batch a contiguous per-(session, agent) `seq`; the watermark is the latest assigned seq. The journal holds up to 2000 batches (`TRANSCRIPT_OPS_JOURNAL_CAPACITY`) and dies with the live store.

## 4. WebSocket protocol

### 4.1 Subscribing

```json
{ "type": "subscribe_v2", "id": "sub-1",
  "payload": { "session_id": "<sid>",
               "transcript": { "*": "delta" },
               "transcript_since": { "main": 42 } } }
```

- `transcript`: `{ <agentId|'*'>: grade }`, grade ∈ `off | turn | block | delta`.
- `transcript_since`: optional, carries the last-seen seq per agent. If the journal still covers it, the op batches are replayed; if not (or the session is cold), the server falls back to `transcript.reset`.
- `unsubscribe_v2`: `{ agent_ids? }`; omitting `agent_ids` drops the transcript subscription for the whole session. A dropped agent resumes receiving legacy `session_event`s.
- Upgrading the grade triggers a resend of `reset`; downgrading or staying at the same grade does not.

### 4.2 Delivered frames

Transcript frames are wrapped in the session event envelope (the outer `seq` is the session-event journal sequence, unrelated to `payload.seq`, which is the transcript op-batch sequence):

```json
{ "type": "transcript.ops", "seq": 137, "epoch": "...", "volatile": true,
  "session_id": "<sid>", "timestamp": "<ISO>",
  "payload": { "type": "transcript.ops", "agent_id": "main",
               "ops": [ /* TranscriptOp[] */ ], "seq": 43 } }

{ "type": "transcript.reset", "seq": 136, "volatile": true, "session_id": "<sid>",
  "payload": { "type": "transcript.reset", "agent_id": "main",
               "snapshot": { "items": [], "tasks": [], "interactions": [],
                             "attachments": [], "todos": [], "prompts": [], "meta": {} },
               "has_more_older": true, "seq": 43 } }
```

- A baseline reset always carries `items: []` (`TRANSCRIPT_RESET_TAIL_TURNS = 0`); history always goes through REST pagination.
- Send timing: on first subscription (after history backfill completes), on grade upgrade, and when the roster gains a new agent.

### 4.3 Granularity filtering

For the same store change, what each grade delivers:

| op type | off | turn | block | delta |
|---|---|---|---|---|
| turn.upsert / meta.merge / task / interaction / marker / todo / prompt / attachment / items.remove | - | yes | yes | yes |
| step.upsert / frame.upsert | - | - | yes (full frame) | yes |
| append | - | - | - | yes |
| reset snapshot | - | turn's `steps` emptied to `[]` | full | full |

A `block`-grade subscriber only receives empty `frame.upsert` frames during streaming; when a step completes, the projector's `flushOpenFrames` sends one full frame, so block grade still ends up with the complete text.

### 4.4 Legacy event suppression

Once a connection has subscribed to transcript for an agent (grade ≠ off), the transcript-projected legacy `session_event`s for that connection × agent (`TRANSCRIPT_PROJECTED_EVENT_TYPES`, 44 types) stop being sent; the journal still records them, and unsubscribed connections are unaffected. `prompt.queued` is the one exception — it is not in the suppression set and is sent on both channels.

## 5. REST API

All responses use the `{ code, msg, data, request_id }` envelope.

### 5.1 `GET /sessions/{id}/transcript`

query: `agent_id` (required), `before_turn | after_turn` (mutually exclusive), `page_size` (1-100, default tail page of 20 turns).

```json
{ "agent_id": "main", "items": [ /* Turn | Marker | TaskRef */ ],
  "has_more": true,
  "tasks": [], "interactions": [], "attachments": [], "todos": [],
  "prompts": [], "meta": {},
  "agents": [ /* AgentDescriptor */ ],
  "pending_interactions": [], "seq": 43 }
```

`seq` is that agent's current watermark. Live sessions read the in-memory store; cold sessions rebuild from `wire.jsonl`.

### 5.2 `GET /sessions/{id}/transcript/ops`

query: `agent_id`, `since_seq`.

```json
{ "agent_id": "main",
  "batches": [ { "seq": 43, "ops": [] } ],
  "latest_seq": 47,
  "complete": true }
```

`complete: false` means the journal no longer covers `since_seq` or the session is cold; the caller must do a full refresh.

### 5.3 `GET /sessions/{id}/transcript/user-messages`

Returns the list of user messages per agent:

```json
{ "agents": [ { "agent_id": "main",
                "messages": [ { "turn_id": "t1", "ordinal": 1, "state": "completed",
                                "origin": { "kind": "user" }, "prompt": "...",
                                "attachment_ids": [], "started_at": "..." } ],
                "attachments": [] } ] }
```

`agent_id` is optional: when present it reads one agent, when absent it reads every rostered agent. A turn qualifies when it has a defined `prompt` (real user text, user slash/skill/plugin commands, cron prompts — distinguished via `origin`) or attachment-only prompts (projected with an empty prompt string). Unpaginated; referenced attachment entities ride along as metadata only.

### 5.4 `GET /sessions/{id}/transcript/plan`

query: `agent_id` (required), `tool_call_id` (optional, narrows to a single call).

```json
{ "agent_id": "main",
  "plans": [ { "tool_call_id": "call_1", "turn_id": "t1",
               "source": "interaction", "plan": "...", "path": "...",
               "options": [ { "label": "...", "description": "..." } ],
               "review": { "state": "approved", "selected_option": "...", "feedback": "..." } } ] }
```

Plan content is projected from, in priority order: the linked approval interaction's request display (`source: "interaction"`, covers interactive reviews, live or cold), the live tool frame's `display` (`source: "display"`, auto mode), or the tool result output text (`source: "output"`, cold rebuilds without an interaction). An unknown or non-ExitPlanMode `tool_call_id` returns `TOOL_CALL_NOT_FOUND`.

### 5.5 `POST /sessions/{id}/transcript/plan::reveal`

body: `{ agent_id, tool_call_id }`. Reveals the saved ExitPlanMode Markdown file in the host file manager. The gateway resolves and verifies the saved plan's on-disk location itself (under `agents/<agentId>/plans/` inside the session directory, symlinks rejected) rather than accepting a path from the client; returns `{ revealed: true }` on success, or `FILE_NOT_FOUND` / `TOOL_CALL_NOT_FOUND` on failure.

## 6. Session-level work status

Session-granularity busy/idle state is aggregated by core's `ISessionActivityView` and delivered through `event.session.work_changed`:

```json
{ "busy": false, "main_turn_active": false,
  "pending_interaction": "none", "last_turn_reason": "completed" }
```

`pending_interaction` ∈ `none | approval | question`; `last_turn_reason` ∈ `completed | cancelled | failed`. The same view also feeds the REST session facts and the v2 `activity.status` (priority order `approval > question > running > failed > idle`).

## 7. Event sources

Core observable events consumed by the live projector (main ones): `turn.started`, `turn.ended`, `turn.step.started/completed/interrupted/retrying`, `assistant.delta`, `thinking.delta`, `tool.call.started/delta`, `tool.result`, `tool.progress`, `task.started/terminated/notified`, `shell.started/output/completed`, `subagent.spawned/started/completed/failed/suspended`, `prompt.accepted/queued/submitted/started/completed/aborted/steered`, `goal.updated`, `agent.status.updated`, `agent.activity.updated`, `interaction.request/resolved` (through the session interaction-state subscription), `error`, `warning`, `hook.result`, `cron.fired`, `skill.activated`, `plugin_command.activated`, `compaction.*`, `context.spliced/undone`.

Durable record types consumed by the cold fold: `turn.prompt`, `turn.ended`, `turn.cancel`, `turn.steer`, `turn.step.interrupted`, `context.append_message`, `context.append_loop_event` (embedding `step.begin` / `step.end` / `content.part` / `tool.call` / `tool.result`), `context.undo/clear/apply_compaction`, `interaction.request/resolved`, `task.started/terminated`, `goal.create/update/clear`, `plan_mode.enter/exit/cancel`, `plan.revision`, `dynamic_workflow_mode.enter/exit`, `tower_mode.enter/exit`, `tools.update_store`.

## 8. Versioning and migration convention

1. **Contract carrier**: the zod schema in `src/contract/schema.ts` is the sole authoritative definition of the wire contract; this document is its readable form. Where they disagree, the schema wins and this document must be corrected.
2. **`wire.jsonl` only grows, never changes**: new record types may be added, and optional fields may be added to existing records; deleting, renaming, or changing the meaning of a field is forbidden. Old files must always remain replayable (zod `optional()` keeps `safeParse` passing).
3. **A transcript contract change must ship with a migration document**: any addition, removal, or change to entity fields, op types, frame shapes, REST responses, or grade semantics needs a new `NNNN-<kebab-title>.md` under `docs/migrations/`, numbered sequentially. A migration document must contain five sections:
   - **Summary of change**: one sentence on what changed and why.
   - **Old → new mapping**: a table of the field/enum/op correspondence (including where removed items went).
   - **Impact on consumers**: what the Pythinker Code app / pythinker-inspect / klient / external clients each need to adapt.
   - **Wire compatibility**: the list of newly added record types; how old `wire.jsonl` files replay.
   - **Rollback**: how to roll back, and what old clients see after rollback.
4. **Pure additions (a new op, a new optional field, a new enum value with a default handling path) only need a changeset**, not a migration document; migration documents are for removals, renames, and semantic changes.
5. The first planned migration: `docs/migrations/0001-state-model-unification.md` (a state-model unification refactor; the design is drafted in the workspace and will land in the repository together with the code).
