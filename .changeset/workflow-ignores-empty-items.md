---
"@pythoughts/pythinker-code": patch
---

Ignore empty entries in a Dynamic Workflow's item list instead of rejecting the call. A trailing empty item used to fail argument validation, which discarded the whole workflow before any subagent started and forced the agent to send every prompt again. The dropped count is now reported with the results, and the launch panel counts only the subagents that will actually run.
