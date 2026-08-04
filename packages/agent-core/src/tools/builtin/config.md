Get or set supported Pythinker Code configuration settings.

Omit `value` to read a setting. Include `value` to change it. Reads are safe; writes require user approval.

Supported settings:
- `model`
- `permissions.defaultMode`: `yolo`, `manual`, or `auto`
- `alwaysThinkingEnabled`
- `defaultPlanMode`
- `mergeAllAvailableSkills`
- `telemetry`
- `background.maxRunningTasks`
- `background.keepAliveOnExit`
- `background.killGracePeriodMs`
- `background.printWaitCeilingS`
- `loopControl.maxStepsPerTurn`
- `loopControl.maxRetriesPerStep`
- `loopControl.maxRalphIterations`
- `loopControl.reservedContextSize`
- `loopControl.compactionTriggerRatio`
- `experimental.micro_compaction`
- `experimental.vim_mode`
- `experimental.agent_fork_context`
- `experimental.task_graph`
