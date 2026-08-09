---
"@pythoughts/pythinker-code": patch
---

Model permission deny rules now also apply to subagent model overrides coming from agent profiles and from resume or retry, not only to models named in tool arguments; a denied override falls back to the parent agent's model.
