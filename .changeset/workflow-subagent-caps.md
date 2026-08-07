---
"@pythoughts/pythinker-code": minor
---

Bound subagent fan-out with hard caps: 128 subagents per call, 200 per session, and a nesting depth of 3. Nesting was previously unbounded, so a workflow that spawned workflows could grow without limit; past depth 3 the call now fails instead.
