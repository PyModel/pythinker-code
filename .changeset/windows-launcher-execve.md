---
'@pythoughts/pythinker-code': patch
---

Fix the CLI failing to start on Windows with "process.execve is unavailable" by using the spawn fallback instead of calling execve there.
