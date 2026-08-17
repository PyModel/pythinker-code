---
'@pymodel/pythinker-code': patch
---

Recover the web and desktop app when a session snapshot request fails. It is now retried with a growing delay instead of leaving the todo list and the sub-agent list frozen until a reload, and a failed task refresh reports itself rather than failing in silence.
