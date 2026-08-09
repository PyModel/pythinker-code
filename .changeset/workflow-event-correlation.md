---
"@pythoughts/pythinker-code": patch
---

Subagent lifecycle events now carry the workflow name on start, completion and failure, and suspension events carry both the workflow run id and name, so clients can correlate every event without caching the spawn event.
