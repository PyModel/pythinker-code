---
"@pymodel/pythinker-code": patch
---

Request remote client configuration only when `CUSTOM_API_BASE_URL` is set, so the sign-in token is no longer sent to an unconfigured placeholder host.
