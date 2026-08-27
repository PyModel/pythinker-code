---
"@pymodel/pythinker-code": patch
---

Retry a failed session journal repair before writing new records, so no message is appended behind a corrupted tail.
