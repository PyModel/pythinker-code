---
name: check-pythinker-code-docs
description: Answer questions about the Pythinker Code product using the official documentation — CLI usage, configuration, slash commands, features, and guides. Use when the user asks how Pythinker Code works, how to set something up, or how a documented feature behaves.
---

# Check Pythinker Code docs (check-pythinker-code-docs)

Answer Pythinker Code **product** questions from the official documentation site, not from memory. This skill covers product usage ("how do I configure a provider", "what does this error message mean", "how does Remote Control work"); it is not for developing the Pythinker Code repository itself.

## The single source of truth

Official documentation (English):

```
https://code.pythinker.com/pythinker-code/en/
```

Fetch pages with **FetchURL** before answering. All page links below are relative to this base.

## Which page to read for which question

| Question topic | Page (relative to the base URL) |
| --- | --- |
| What Pythinker Code is; getting started; install and first run | `./` (home overview), `guides/getting-started.html` |
| Providers and models, API keys | `configuration/providers.html` |
| `config.toml` fields, environment variables, data locations, config overrides | `configuration/` — `config-files.html`, `env-vars.html`, `data-locations.html`, `overrides.html` |
| Skills, MCP, hooks, plugins, themes, agents/sub-agents | `customization/` — `skills.html`, `mcp.html`, `hooks.html`, `plugins.html`, `themes.html`, `agents.html` |
| Sessions and context, interaction and input, IDEs, use cases | `guides/` — `sessions.html`, `interaction.html`, `ides.html`, `use-cases.html` |
| Desktop app, Remote Control, browser web UI | `guides/` — `desktop.html`, `remote-control.html`, `web.html` |
| Slash commands, keyboard shortcuts, builtin tools, `pythinker` command flags, ACP, server API, release channels | `reference/` — `slash-commands.html`, `keyboard.html`, `tools.html`, `pythinker-command.html`, `pythinker-acp.html`, `server-api.html`, `release-channels.html` |
| CLI changelog | `release-notes/changelog.html` |

If no row fits the question, fetch the docs home page and follow its navigation links.

## How to answer

1. Pick the page from the table above.
2. **FetchURL the page before answering** — answer strictly from the fetched content, never from memory.
3. Cite the page link(s) you used at the end of the answer.
4. If the fetch fails or the docs do not cover the question, say so plainly: answer from what you already know, attach the docs entry link (`https://code.pythinker.com/pythinker-code/en/`), and mark which parts you could not verify. **Never invent config keys, command names, model IDs, or product behaviors.**
