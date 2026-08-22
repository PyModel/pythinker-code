---
"@pymodel/pythinker-code": minor
---

Add `POST /api/v1/sessions/{id}/fs:write` so API clients can save workspace files; passing `base_etag` fails with `40928` instead of overwriting a concurrent change.
