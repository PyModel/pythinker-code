---
"@pythoughts/pythinker-code": minor
"@pythoughts/pythinker-code-sdk": minor
---

Name the managed OAuth provider after the platform that serves it. It is reached over `auth.kimi.com` and `api.kimi.com`, but it was registered as `managed:pythinker-code`, which read as a first-party service in a client that talks to several providers. The provider id is now `managed:kimi-code`, its models are aliased `kimi-code/*`, and its credentials are stored under `oauth/kimi-code`.

This is a breaking change for an existing config: the previous entries are not rewritten, so run `pythinker login` once to provision the managed provider under its current name, then remove the stale `managed:pythinker-code` entry.
