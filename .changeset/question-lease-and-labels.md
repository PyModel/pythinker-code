---
'@pymodel/pythinker-code': minor
---

Questions now stay open for 30 minutes instead of 60 seconds, and the card warns when the lease is close to its end. An expired question is no longer reported to the agent as a user dismissal, answers carry the question text and the option labels the user saw instead of internal ids, Escape no longer dismisses an open question, and a question that cannot be delivered now fails as a tool error instead of a silent dismissal.
