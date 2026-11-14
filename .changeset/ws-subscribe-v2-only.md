---
"@pymodel/pythinker-code": major
---

Merge the `pythinker web` WebSocket session subscriptions into `subscribe_v2` and remove the old `subscribe`/`unsubscribe` frames and the `/sessions/{id}/snapshot` route; clients built for the old frames must move to `subscribe_v2`.
