---
'@pythoughts/pythinker-code-sdk': minor
'@pythoughts/pythinker-code': minor
---

Show the plan before a Dynamic Workflow runs, and let a good one be saved as a command

Manual mode used to approve every `DynamicWorkflow` call outright. That approval
only ever fired in manual mode — auto and yolo approve earlier in the chain — so
the one mode whose purpose is to ask was the one mode that never saw what it was
agreeing to. A `DynamicWorkflow` call in manual mode now asks, and the approval
carries the fan-out: how many subagents, the task list, the prompt template, the
worker model, and the summed size of the prompts about to be sent. "Approve for
this session" is keyed to that workflow's description rather than granting every
future `DynamicWorkflow` call.

`/workflow save <name>` writes the last run back out as a skill under
`.pythinker-code/skills/`, so a fan-out that worked can be re-run by name.
