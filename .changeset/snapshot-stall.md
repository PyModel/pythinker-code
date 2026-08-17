---
'@pymodel/pythinker-code': patch
---

Stop the session snapshot request from timing out on busy sessions. Each recorded event no longer pays a fresh file open and close, the watermark is read without waiting for pending writes, and the session list is scanned in parallel, so opening or refreshing a session stays fast even with a long history. This was most visible on Windows, where the per-event file cost is highest.
