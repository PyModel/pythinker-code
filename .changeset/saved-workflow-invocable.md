---
"@pythoughts/pythinker-code": patch
"@pythoughts/pythinker-code-sdk": minor
---

Fix `/workflow save` leaving the saved workflow uncallable until the session was reloaded, and add `Session.reloadSkills()` to re-discover skills written while a session is open.
