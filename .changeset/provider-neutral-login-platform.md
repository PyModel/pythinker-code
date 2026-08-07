---
"@pythoughts/pythinker-code-sdk": minor
"@pythoughts/pythinker-code": minor
---

Make the login platform layer provider-neutral. Model listing, capability derivation and the on-disk config shape are now one set of types shared by every login path, instead of living in a provider-specific module that other providers imported from; the duplicate copies of the capability derivation and the model-info parser are collapsed into one.

Logging in is an API key, a models.dev catalog provider, or OpenAI Codex OAuth. "Is the user logged in" is now a single predicate over configured providers with a usable credential, shared by the CLI, the VS Code extension and the ACP adapter. `/feedback` opens the issue tracker.
