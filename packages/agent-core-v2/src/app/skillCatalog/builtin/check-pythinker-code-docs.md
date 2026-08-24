---
name: check-pythinker-code-docs
description: Answer questions about the Pythinker Code product using the official documentation — CLI usage, configuration, slash commands, features, membership and quota, API onboarding, third-party tool setup, and error codes. Use when the user asks how Pythinker Code works, how to set something up, or what a Pythinker Code error message means.
---

# Check Pythinker Code docs (check-pythinker-code-docs)

Answer Pythinker Code **product** questions from the official documentation site, not from memory. This skill covers product usage ("how do I configure a provider", "what does this error mean", "how does membership quota work"); it is not for developing the Pythinker Code repository itself.

## The single source of truth

Official documentation (English):

```
https://github.com/PyModel/pythinker-code/tree/main/docs/en
```

Fetch pages with **FetchURL** before answering. All page links below are relative to this base.

## Which page to read for which question

| Question topic | Page (relative to the base URL) |
| --- | --- |
| What Pythinker Code is; Base URL / API Key; standard vs high-speed model; platform comparison | `./` (home overview) |
| Membership plans, quota and rate limits, fuel packs | `pythinker-code/membership.html` |
| Install / login / usage FAQ | `pythinker-code/faq.html` |
| Error codes and their meaning (e.g. 401 for high-speed model access) | `pythinker-code/error-reference.html` |
| Product news and recent changes | `pythinker-code/whats-new.html` |
| Community guidelines; contact and feedback | `pythinker-code/community-guidelines.html`, `pythinker-code/contact-and-feedback.html` |
| `config.toml` fields, providers/models, environment variables, data locations, config overrides | `pythinker-code-cli/configuration/` — `config-files.html`, `providers.html`, `env-vars.html`, `data-locations.html`, `overrides.html` |
| Skills, MCP, hooks, plugins, themes, agents/sub-agents | `pythinker-code-cli/customization/` — `skills.html`, `mcp.html`, `hooks.html`, `plugins.html`, `themes.html`, `agents.html` |
| Getting started, sessions and context, goals, interaction and input, IDEs, migration, use cases | `pythinker-code-cli/guides/` — `getting-started.html`, `sessions.html`, `goals.html`, `interaction.html`, `ides.html`, `migration.html`, `use-cases.html` |
| Slash commands, keyboard shortcuts, builtin tools, `pythinker` command flags, ACP | `pythinker-code-cli/reference/` — `slash-commands.html`, `keyboard.html`, `tools.html`, `pythinker-command.html`, `pythinker-acp.html` |
| CLI changelog | `pythinker-code-cli/release-notes/changelog.html` |
| Using Pythinker Code in Claude Code and other third-party agents | `third-party-tools/other-coding-agents.html` |

If no row fits the question, fetch the docs home page and follow its navigation links.

## How to answer

1. Pick the page from the table above.
2. **FetchURL the page before answering** — answer strictly from the fetched content, never from memory.
3. Cite the page link(s) you used at the end of the answer.
4. If the fetch fails or the docs do not cover the question, say so plainly: answer from what you already know, attach the docs entry link (`https://github.com/PyModel/pythinker-code/tree/main/docs/en`), and mark which parts you could not verify. **Never invent config keys, command names, model IDs, or product behaviors.**
