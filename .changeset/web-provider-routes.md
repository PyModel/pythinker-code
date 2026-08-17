---
"@pymodel/pythinker-code": minor
---

Point the web provider calls at routes that exist. Adding a provider now writes through `POST /config`, refreshing reads `GET /providers/{id}`, and a new `DELETE /providers/{provider_id}` route removes a provider together with the model aliases that referenced it.
