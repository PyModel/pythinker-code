Here is the English translation of the specification document:

---

# Goal Feature Breakdown

This document breaks down the goal mode capabilities in `agent-core` into three distinct parts:

1. **Core Workflow:** Essential runtime logic without which goal mode cannot run.
2. **Metrics / Token Limits:** Makes goals measurable, limitable, and auditable.
3. **User Interaction:** Allows users to safely initiate, understand, control, and resume goals.

## 1. Core Workflow

The core workflow forms the operational backbone of goal mode. It handles creating structured goals, maintaining the state machine, chaining regular turns into autonomous multi-turn execution, and enabling the model to transition or park goals via machine-readable signals.

### Goal States

The same main agent can hold at most **one** current goal at a time. A goal is not arbitrary chat text, but a structured state held by the runtime—containing at least the objective, optional completion criteria, current status, stop reason, and run metrics.

States fall into four categories:

- `active`: Currently being driven by the goal driver. Only this state automatically triggers the next turn.
- `paused`: Temporarily halted while retaining the goal. Typically caused by user pause, user interruption, post-process recovery degradation, or provider/runtime errors. Resumable.
- `blocked`: Confronted with a real blocker while retaining the goal. Typically caused by the model determining that external input is needed, the goal cannot be completed as currently stated, a budget limit has been reached, or a prompt hook has blocked execution. Resumable.
- `complete`: A transient completion state. The runtime emits a completion event and immediately clears the goal; it is not persisted long-term.

There is no `cancelled` state. Canceling simply clears the goal and instructs the model to ignore prior active reminders regarding that goal.

### Creation and Replacement

When creating a goal, the runtime must validate that the objective is neither empty nor excessively long. If an `active`, `paused`, or `blocked` goal already exists, new goal creation is rejected by default to prevent silent overwrites. A new goal replaces an existing one only when the user or caller explicitly requests replacement, in which case the old goal is cleared first.

Upon creation, the new goal enters `active` status, is saved to persistent records, and triggers a goal update event.

### Multi-Turn Driver

The goal driver is responsible for progressing an `active` goal across continuous turns:

- If a goal is already `active` at the start of a turn, execution enters the goal driver.
- If the model creates a goal within a standard turn, or resumes a `paused`/`blocked` goal to `active`, the goal driver takes over execution after the current turn ends.
- The driver executes only one standard turn at a time.
- After each turn completes, the driver checks the goal status.
- If the goal remains `active`, the runtime automatically appends a continuation prompt and starts the next turn.
- If the goal transitions to `paused`, `blocked`, or is cleared, the driver stops.

If the model does not call a status update tool and the goal remains `active`, the runtime continues to the next turn. The model cannot complete a goal merely by stating "done" in natural language; it must emit a structured status signal.

### Goal Injection

At the boundaries of each goal turn, the runtime injects the current goal state into the context. Injected content includes:

- Notification that the session is currently in goal mode.
- The objective and completion criteria.
- Explicit notice that goal text is user-supplied data and must not override system/developer instructions, tool schemas, permission rules, or host controls.
- Current status and progress.
- Guidance for the model to perform a concise self-review and execute one coherent, manageable slice of work.
- Instructions to directly mark simple, already-completed, impossible, unsafe, or contradictory goals as `complete` or `blocked` within the same turn.
- Guidance to mark `complete` only when all requirements are met, verification passes, and no further useful steps remain.
- Instructions to mark `blocked` when progress is halted by external dependencies or required user input.
- Instructions not to mark `complete` if only planning, summarizing, initial drafting, or partial execution has occurred.

Goal injection occurs strictly at turn/continuation boundaries rather than at every model step. This prevents context bloat and preserves prompt cache efficiency.

Injections for `paused` and `blocked` goals are lighter:

- `paused`: Reminds the model that the goal exists but should not proceed autonomously unless the user explicitly requests continuation.
- `blocked`: Reminds the model that the goal is blocked and paused, unless the user addresses the blocker or requests a resume.

### Continuation Prompt

When a goal remains `active`, the runtime appends a system-triggered input equivalent to "continue working toward the current active goal." Beyond simply driving execution, it prompts the model to re-evaluate at each turn:

- Whether the goal is already complete.
- Whether a genuine blocker has been encountered.
- Whether it should complete a reasonable slice of work before yielding to the next turn.
- Whether it should avoid diverging or starting unrelated work.
- Whether to refrain from asking the user for input unless genuinely blocked.

### Completion, Blocking, and Pausing

The model controls the goal lifecycle through structured status updates:

- `complete`: Objective satisfied; runtime emits a completion event and clears the goal.
- `blocked`: Real blocker encountered; runtime retains the goal and halts autonomous progression.
- `paused`: Goal temporarily set aside; runtime retains the goal and halts autonomous progression.
- `active`: Resumes a `paused` or `blocked` goal.

Status update tool inputs should remain narrow, expressing only machine state. The model provides completion summaries or blocking reasons to the user in subsequent conversational output.

When the model marks a goal `complete`, the runtime grants one final wrap-up turn for the model to generate a brief summary detailing what was accomplished and verified.

When the model marks a goal `blocked`, the runtime similarly grants a wrap-up turn to explain the specific blocker and what inputs or changes are required to proceed.

If the current turn has exhausted its step budget, the runtime should avoid forcing an extra wrap-up step, preventing "failed to generate summary" from becoming a turn-level failure.

### Error Parking

Goal mode treats technical execution failures as recoverable parking events:

- User interrupts current turn: goal transitions to `paused`.
- Provider rate limit: goal transitions to `paused`.
- Provider connection, authentication, or API errors: goal transitions to `paused`.
- Model configuration errors: goal transitions to `paused`.
- Runtime exceptions: goal transitions to `paused`.
- Provider safety filters: goal transitions to `paused`.

Conversely, business logic, rules, or external blockers trigger `blocked`:

- Prompt hooks blocking the goal.
- Model determining it cannot proceed.
- Budget exhausted.
- Requirement for new conditions from the user or external systems.

### Persistence and Recovery

Goal creation, updates, completion, blocking, and clearing must be written to persistent records. Upon session restoration, the runtime uses these records to reconstruct the goal.

If a restored goal was previously `active`, it must not automatically resume execution; instead, it is downgraded to `paused`. Active turns from prior processes cannot remain alive, and auto-resuming risks silently consuming resources after a restart.

`paused` and `blocked` states are preserved as-is. `complete` states do not persist long-term, as completed goals are cleared.

When a session is forked, the new session does not inherit the source session's goal, and the model is instructed not to pursue the old goal.

---

## 2. Metrics / Token Limits

This section makes goals measurable, limitable, and auditable. Without it, goals can still execute, but lack control boundaries.

### Execution Metrics

Goal metrics track:

- Continuation turn count.
- Token consumption.
- Active wall-clock duration.

Metrics accumulate only while the goal is `active`. Counting halts during `paused` and `blocked` periods.

Turn metrics increment as each goal turn prepares to run. Consequently, if the model marks a goal `complete` during a turn, that turn is included in the final metrics.

Token usage accumulates after each model step completes. Tokens consumed outside an `active` goal are not attributed to goal metrics. Token metrics should update silently in the background rather than refreshing the UI at every step.

Time metrics measure active pursuit duration. Timer intervals start upon entering `active` and flush to cumulative totals upon leaving `active`; pause/resume cycles create distinct active intervals.

### Budgets

Goal budgets support:

- Turn budget.
- Token budget.
- Wall-clock time budget.

Budgets are omitted by default and set only when explicitly defined by the user (e.g., "max 20 turns," "under 500k tokens," "within 30 minutes"). Vague requests (e.g., "as fast as possible," "don't take too long") must not trigger budget settings, nor should the model invent budgets arbitrarily.

Time budgets require valid ranges; excessively short or long durations are rejected. Turn and token budgets must be normalized to positive integers.

### Hard Budget Stops

Budget checks occur before and after each goal turn. Token budgets are also evaluated after individual model steps to prevent execution from continuing after an overrun.

Once a budget limit is reached, the runtime immediately marks the goal `blocked` with a reason indicating budget exhaustion. This `blocked` state remains resumable, though resuming without altering the budget may trigger an immediate re-block.

### Budget Nudging and Final Metrics

When budget usage is low, system prompts encourage steady progress. When any budget metric exceeds 75% utilization, prompts shift focus toward convergence, advising against initiating optional or tangential work.

Final response prompts for `complete` and `blocked` states should incorporate summary metrics (e.g., turns worked, elapsed time, tokens consumed). UI events should similarly include current metric snapshots and event types.

Telemetry may record events such as goal creation, budget allocation, continuations, status changes, and clearing, but must exclude sensitive payload data like raw objective text or stop reasons.

---

## 3. User Interaction

This section enables users to safely initiate, observe, control, and recover goals. Without it, the runtime can function, but lacks appropriate UX and security boundaries.

### Lifecycle Control

Users retain direct operational control over goals:

- Create
- Inspect
- Pause
- Resume
- Cancel

These actions execute directly without requiring model turn processing. Pausing moves an `active` goal to `paused`; resuming transitions a `paused` or `blocked` goal back to `active`; canceling immediately clears the goal.

Resuming clears previous stop reasons to signify a fresh attempt. Sending standard user messages does not automatically resume `paused` or `blocked` goals.

### Confirmation for Model-Initiated Goals

The model may create goals on behalf of the user, but only when explicitly requested (e.g., commands to start autonomous work) or mandated by host goal-intake prompts. Standard conversational requests must not be unilaterally upgraded into goals by the model.

When the model invokes `CreateGoal` under non-auto permission modes, a user confirmation prompt must trigger. The confirmation UI allows the user to select the execution permission mode for the session. If the user declines, the goal is not created.

Read/update control tools (`GetGoal`, `SetGoalBudget`, `UpdateGoal`) modify runtime goal state and can generally receive broader auto-approval. File writes, shell executions, and sensitive path access remain governed by standard host permission systems.

### Context Prompts After Pause, Block, or Cancel

- **Paused:** Context prompts state that a goal exists but must not proceed autonomously unless explicitly requested by the user.
- **Blocked:** Context prompts state that the goal is blocked and halted, offering to assist with unblocking if requested, but otherwise defaulting to handling standard user prompts.
- **Cancelled:** Appends instructions directing the model to ignore active reminders for the prior goal, preventing stale context from prompting continued work on cancelled targets.

### User Responses on Complete and Blocked

- **On Complete:** Goal is cleared; the model provides a concise completion summary detailing results and verifications performed.
- **On Blocked:** Goal is retained; the model provides a concise explanation of the blocker, outlining required inputs, permissions, external conditions, or adjustments needed to continue.

### Tool Exposure and Isolation

Goal management tools are restricted to the **main agent**. Subagents must not directly create, resume, or terminate primary goals.

When no goal is active, `UpdateGoal` and `SetGoalBudget` are hidden from the model schema and exposed only when a goal exists.

Internal Goal IDs are not exposed to the model, as they serve strictly internal runtime/UI routing needs without user-facing semantic value.

### Goal Authoring Assistance

`write-goal` capabilities help refine raw user intent into actionable goal contracts. A well-defined goal explicitly identifies:

- **End State:** What conditions must hold true upon completion.
- **Proof:** What observable evidence verifies completion.
- **Boundaries:** Permissible scope and explicitly prohibited actions.
- **Loop:** Strategy for iterative execution.
- **Stop Rule:** Specific conditions triggering a halt and report, avoiding brute-force iteration.

Budgets are opt-in and should neither be included by default nor hardcoded as turn caps into the objective text itself.

### UI and Session Semantics

Goal creation, pausing, resuming, blocking, completion, and clearing trigger `goal updated` events. Distinction is maintained between lifecycle transitions and completion events: completion is a terminal event after which the goal snapshot clears to `null`. `blocked` and `paused` states preserve their snapshots, allowing UI interfaces to display resumable goals.

During session restoration, active goals degrade to `paused` to prevent automatic background execution upon restart. Session forks do not inherit goals, and the model is instructed not to pursue goals originating from the source session.
