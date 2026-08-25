# Goal pause during compaction assessment

- Date: 2026-08-25
- Status: implemented and verified
- Severity: medium
- Confidence: high for v2; high from source for the v1 custom-strategy path

## Verdict

The repeated cancellation bug is real in v2 when auto-compaction can run in the background. The
recurring cancellation normally comes from the history-safety guard, not from the blocked step's
abort signal.

The proposed pause/resume fix is directionally correct, but reusing the current goal pause and
`resumeGoal()` paths is not safe. The fix must preserve the live goal turn, make a below-block-ratio
goal step wait for compaction, and resume only after a successful compaction with no later user,
budget, goal, or restart override.

Decision:

- Fix auto-compaction only. Manual compaction already requires loop quiescence.
- Fix v2 as the active production path.
- Add v1 parity for custom `compactionStrategy` users, but use a v1-specific continuation launch.
- Use the existing `goal.updated` TUI marker. Do not add a second goal-state path to the compaction
  component.

## Findings

### F1 — The repeated cancellation path is the unsafe-history guard

When `loopControl.compactionTriggerRatio` is below `0.85`, v2 uses the lower value as the trigger
ratio and keeps `0.85` as the block ratio. This enables non-blocking after-step checks
(`packages/agent-core-v2/src/agent/fullCompaction/strategy.ts:62-64,91-100`).

The repeating sequence is:

1. `afterStep()` starts an auto-compaction without waiting for it
   (`fullCompactionService.ts:502-506`).
2. The goal turn ends and `handleTurnEnded()` enqueues another continuation
   (`goalAgentRuntime.ts:658-691`).
3. The loop materializes that continuation into context before its next step
   (`loopService.ts:807-821`). Its origin is `system_trigger/goal_continuation`
   (`goalAgentRuntime.ts:761-782`).
4. The compaction result sees a new non-user tail. `historySafeToCompact()` rejects it
   (`fullCompactionService.ts:732-738,835-842`) because `system_trigger` messages are dropped
   (`compactionHandoff.ts:159-182`).
5. Compaction emits `compaction.cancelled`. The still-large goal turn reaches the same boundary and
   starts the next compaction.

A temporary contract test used the real v2 loop, goal, context, and compaction services and stubbed
only the model boundary. It forced the same after-step `source: 'auto'` seam, observed three
compaction attempts and two consecutive cancellations, and passed. The temporary file was removed
after evidence capture.

This path does not require the step signal to abort. `propagateBlockingAbort()`
(`fullCompactionService.ts:551-558`) is a separate cancellation source for a compaction that is
already blocking a step.

### F2 — The default blocking path does not create the reported loop by itself

The default trigger and block ratios are both `0.85`. `beforeStep()` starts compaction and waits in
`block()` before the model step can continue (`fullCompactionService.ts:494-499,535-549`). Context
overflow recovery also always waits (`fullCompactionService.ts:464-473`). The turn cannot end and
the goal cannot enqueue another continuation while that wait is unresolved.

If an external cancel, deadline, shutdown, or user interrupt aborts that step, the abort listener can
cancel compaction. The same turn then ends abnormally and the goal runtime pauses it
(`goalAgentRuntime.ts:719-735`). That is not the recurring continuation loop.

Current regression evidence supports this distinction: the existing active-goal/default-compaction
test completes successfully and reinjects the goal reminder before the post-compaction request.

### F3 — A normal goal pause would cancel the compaction

In v2, leaving `active` calls `cancelPendingContinuation()` unless the caller sets
`preserveLiveContinuation` (`goalAgentRuntime.ts:883-904`). That function aborts the queued receipt
or cancels its assigned loop turn (`goalAgentRuntime.ts:822-833`). For a blocking goal continuation,
the turn signal then reaches `propagateBlockingAbort()` and cancels compaction.

The compaction pause therefore needs a dedicated internal transition that uses the existing
`preserveLiveContinuation` option. Calling the current public `pauseGoal()` or `pauseActiveGoal()`
unchanged would reproduce the failure.

A status pause is also insufficient when compaction starts in `beforeStep()` below the `0.85` block
ratio. That same model step can still run and mutate history. The goal's before-step hook must wait
for the active auto-compaction task before it calls the next hook. Register this ordering explicitly
after the `full-compaction` hook.

### F4 — Reusing `resumeGoal()` is not robust

The v2 `resumeGoal()` method launches work only for actor `user` with `continueIfPaused` or
`continueIfBlocked` (`goalAgentRuntime.ts:393-420`). A runtime actor changes the status to `active`
but can leave an idle goal with no continuation. Pretending the runtime is the user gives incorrect
telemetry and can set `resumeContinuation`; a later real interruption can then launch another turn
from the cancelled-turn branch (`goalAgentRuntime.ts:663-672`).

Use an internal compaction-success resume operation. It must consume one transient resume token and
apply this state table:

A user resume request while compaction is still live must mean "resume after successful compaction."
It must keep the goal paused and must not launch a turn immediately.

| Finish state | Required result |
| --- | --- |
| Success; same goal is still paused for this compaction | Set `active` as actor `runtime`. If a preserved turn is live, launch nothing. If the loop is idle with no pending continuation, launch exactly one continuation. |
| Compaction cancel or failure | Stay paused. Replace the promise-to-resume reason with a truthful failure reason. |
| User paused, cancelled, or replaced the goal during compaction | User intent wins. Consume the token and never launch stale work. |
| A goal budget became final or the goal became blocked/complete | Do not resume. Preserve the newer terminal state. |
| Process replay after an in-flight compaction | Do not auto-resume. The transient token is gone; replace the stale reason with an agent-restart pause reason. |

The current goal fold only changes `terminalReason` when status changes
(`goalAgentRuntime.ts:1361-1368`). The fix needs a narrow same-status reason update so user pause,
compaction failure, and replay cannot leave the text "will resume" after auto-resume was cancelled.

### F5 — v1 and TUI need different scope than proposed

V1 accepts `loopControl.compactionTriggerRatio` in its schema, but its production
`FullCompaction` constructor applies only `reservedContextSize`
(`packages/agent-core/src/config/schema.ts:153-159`,
`packages/agent-core/src/agent/compaction/full.ts:98-112`). Its default trigger and block ratios are
equal, so normal v1 auto-compaction is synchronous. The reported background loop is reachable only
through the public custom `compactionStrategy` option (`packages/agent-core/src/agent/index.ts:94,232`).

That custom path has the same unsafe-tail check (`packages/agent-core/src/agent/compaction/full.ts:588-606`),
but v1 has no independent continuation launcher. After a background compaction pause makes
`driveGoal()` exit (`packages/agent-core/src/agent/turn/index.ts:471-536`), `resumeGoal()` only changes
state. V1 must explicitly launch one continuation after successful compaction when no turn is active.

The current TUI paths are under `apps/pythinker-code`, not `apps/kimi-code`. The live
`goal.updated` handler already renders lifecycle markers (`session-event-handler.ts:751-801`). A
pause reason beginning with `Paused ` renders as `Goal paused ...`
(`components/messages/goal-markers.ts:153-159`), and `/goal status` also shows `terminalReason`
(`components/messages/goal-panel.ts:131-167`). This already supplies the required feedback:

> Goal paused because context compaction is in progress; it will resume after compaction completes

`CompactionComponent` can remain the generic compaction progress block. It does not receive reliable
goal state in `compaction.started`, so adding combined copy there would duplicate lifecycle state.

## Minimum v2 remediation contract

1. Store a transient compaction-pause token with `goalId`. Set it synchronously on auto-compaction
   start, then perform an awaited, re-entrant-safe durable pause with actor `runtime` and
   `preserveLiveContinuation: true`.
2. Gate every continuation launch while the token exists. In the goal before-step hook, wait for the
   active auto-compaction task after the `full-compaction` hook so a below-block-ratio step cannot
   race the summary.
3. Use the compaction task promise as the authoritative outcome. Resume only on promise success;
   cancellation and failure remain paused.
4. Add an internal guarded resume. Recheck goal ID, exact pause cause, current status, budget, live
   turn, pending receipt, and loop idle state. Consume the token before any launch.
5. Let explicit user pause, cancel, and replace actions suppress automatic resume. A user resume
   request keeps the token but launches nothing until success. Normalize a persisted compaction
   pause after replay to a non-resuming reason. Support same-status reason replacement in the
   durable goal fold.

Recommended constants:

- Live pause: `Paused because context compaction is in progress; it will resume after compaction completes`
- Failed finish: `Paused because context compaction did not complete`
- Restart: `Paused because context compaction was interrupted by agent restart`

## Required regression tests

1. V2 after-step background auto-compaction pauses the goal, starts no continuation while running,
   completes once, resumes, and launches exactly one continuation.
2. V2 before-step auto-compaction below the block ratio prevents the goal model request until
   compaction settles, then continues the preserved turn without a duplicate launch.
3. Cancellation and summarizer failure leave the goal paused with truthful text and no API turn.
4. User pause/cancel/replace, budget stop, duplicate finish, and process replay never auto-resume stale
   work.
5. V1 custom-background-strategy parity and TUI pause/resume marker copy pass; v1 default synchronous
   behavior remains unchanged.

## Implementation result

V2 now pauses through the official `onWillCompact` hook and also observes the service's active task
from its ordered before-step and after-step gates. The second path closes a hook-scheduling race in
which another step hook can start compaction before the goal hook runs. The pause is durable, but its
task identity and automatic-resume intent remain transient. Successful settlement rechecks goal ID,
pause reason, status, budget, live turn, pending work, and loop idleness before resuming.

V1 exposes start/finish task events from `FullCompaction`, pauses `GoalMode`, and waits at both turn
step boundaries. The existing v1 goal driver continues its preserved turn after success. Both
engines keep failures paused, defer an explicit resume until success, suppress stale resume after a
user action, and replace a persisted live-compaction reason after process replay.

The TUI uses the existing `goal.updated` lifecycle marker. It renders the required pause reason and
does not duplicate goal state inside the generic compaction component.

## Evidence run

- RED: the v1 and v2 production-path tests first observed an active goal during compaction. The v1
  reminder test also observed a stale paused reminder before the post-compaction active reminder.
- Focused GREEN: v2 coordination 6/6, v2 goal 114/114, v2 goal operations 12/12, v1 compaction
  63 passed with 1 skipped, v1 goal/injection/tools 66/66, and TUI goal markers 10/10.
- Full GREEN: `packages/agent-core-v2` 347 files and 5,661 tests; `packages/agent-core` 228 files,
  4,171 passed, 3 expected failures, 30 skipped, and 1 todo.
- Static gates: v1/v2 `tsc` and `tsgo`, v2 import lint, repository no-comment check, root lint, and
  `git diff --check` exit 0. Root lint reports existing warnings and no errors.
