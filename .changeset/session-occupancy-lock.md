---
"@pymodel/pythinker-code": minor
---

When the same session is open in more than one client, only one can write at a time: sending from a second client now shows a retry/cancel prompt, or reloads changes made elsewhere first and resends your message, and two clients can no longer write to one session at once. Set PYTHINKER_CODE_SESSION_LOCK=0 to allow concurrent writers again.
