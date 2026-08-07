---
"@pythoughts/pythinker-code": patch
---

Keep a Dynamic Workflow subagent's output schema when a provider rate limit forces its turn to be retried. The retried turn lost the schema, so the subagent answered in prose and the workflow reported it as completed rather than as a schema failure.
