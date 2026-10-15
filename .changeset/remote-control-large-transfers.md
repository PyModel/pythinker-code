---
"@pymodel/pythinker-code": patch
---

Remote Control now sends HTTP responses larger than 10 MiB in 5 MiB chunks, up to about 100 MiB, and cancels a transfer when the relay aborts it.
