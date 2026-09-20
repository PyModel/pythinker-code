---
'@pymodel/agent-core-v2': patch
---

Discard streamed attempt state when the LLM requester retries below the turn so interrupted tool-call ids cannot leak into the next attempt.
