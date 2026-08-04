---
"@pythoughts/pythinker-code": patch
---

Fix context compaction failing with provider "Invalid max_tokens" errors by capping requested completion tokens to the remaining context window and a safe output ceiling instead of the full context window size.
