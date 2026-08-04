---
'@pythoughts/pythinker-code': patch
---

Prompt for an API key when connecting a catalog provider whose environment variable is not set, instead of failing with "Environment variable is not set or is empty". Applies to `/login`, `/provider`, and `pythinker provider catalog add`, which now also accepts `--api-key <key>`.
