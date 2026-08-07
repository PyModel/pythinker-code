---
"@pythoughts/pythinker-code": patch
---

Finish handling blank Dynamic Workflow items. A run that dropped one reported its results after a note explaining the drop, which made the whole result parse as unsupported and rendered a successful run as failed; the note now follows the results. A blank entry also no longer leaves a row queued forever with the header stuck below its total, and no longer pushes a full item list over the subagent cap and back into whole-call rejection.
