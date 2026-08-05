---
"@pythoughts/pythinker-code": minor
---

Let a Dynamic Workflow run its subagents on a different model than the agent orchestrating them. `DynamicWorkflow` accepts `model` and `effort` for every subagent in the call, and `/workflow model <alias>` sets that model for the session so an expensive orchestrator can hand mechanical work to a cheaper or faster one.
