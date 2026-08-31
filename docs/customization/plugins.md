# Plugins

Plugins package reusable Pythinker Code CLI capabilities into installable units. They can add [Agent Skills](./skills.md), [agent profiles](./agents.md), slash commands, system-prompt instructions, hooks, and MCP servers. Use them to share workflows with a team or connect the agent to external services.

Installing a plugin only validates and copies its files. Enabled hooks, commands, and MCP servers run only after the plugin is activated and the matching action occurs.

## Installation and management

Run `/plugins` in the terminal interface. Use `Tab` or `Shift-Tab` to switch between **Installed**, **Official**, **Curated**, and **Custom**.

| Key | Action |
| --- | --- |
| `Enter` | View an installed plugin, install its update, or install the selected marketplace plugin |
| `Space` | Enable or disable the selected installed plugin |
| `D` | Remove the selected installed plugin |
| `M` | Manage MCP servers for the selected installed plugin |
| `R` | Reload installed plugins and manifests |
| `I` | View details for the selected installed plugin |
| `Esc` | Close the plugin manager |

You can use slash commands for the remaining operations:

| Command | Description |
| --- | --- |
| `/plugins` | Open the interactive plugin manager |
| `/plugins list` | List installed plugins |
| `/plugins install <path-or-url>` | Install from a local directory, zip URL, or GitHub repository URL |
| `/plugins marketplace [source]` | Browse the default marketplace or a supplied local JSON path or URL |
| `/plugins info <id>` | View plugin details and diagnostics |
| `/plugins enable <id>` | Enable a plugin |
| `/plugins disable <id>` | Disable a plugin |
| `/plugins remove <id>` | Remove a plugin (requires confirmation) |
| `/plugins reload` | Reload `installed.json` and all plugin manifests |
| `/plugins mcp enable <id> <server>` | Enable an MCP server declared by a plugin |
| `/plugins mcp disable <id> <server>` | Disable an MCP server declared by a plugin |

The CLI asks for confirmation before it installs any source that is not an official Pythinker plugin.

### Installing from GitHub

Use `/plugins install <url>` to install directly from a GitHub repository. Four URL forms are supported:

- `https://github.com/<owner>/<repo>`: Install the latest release; falls back to the default branch if no release exists
- `https://github.com/<owner>/<repo>/tree/<ref>`: Install a specific branch, tag, or short commit SHA
- `https://github.com/<owner>/<repo>/releases/tag/<tag>`: Pin to a specific tag
- `https://github.com/<owner>/<repo>/commit/<sha>`: Pin to a specific commit

Network requests only go through `github.com` redirects and `codeload.github.com` downloads; `api.github.com` is not called.

### Notes

- Plugin changes apply after `/reload` or in a new session.
- Local installations are copied to `$PYTHINKER_CODE_HOME/plugins/managed/<id>/`, and the CLI always runs from this managed copy. Editing the original source directory after installation has no effect; you must reinstall.
- Removing a plugin only deletes the installation record; the managed copy and original source files remain on disk.
- Plugins are currently installed per-user and apply to all projects; project-level installation scope is not yet supported.

## Plugin manifest

A direct directory, zip, or GitHub install needs a plugin manifest at one of these locations:

```text
<plugin_root>/pythinker.plugin.json
<plugin_root>/.pythinker-plugin/plugin.json
```

When both exist, Pythinker Code CLI uses `pythinker.plugin.json` and reports the other manifest as shadowed.

Example:

```json
{
  "name": "pythinker-finance",
  "version": "1.0.0",
  "description": "Finance data and analysis workflows for Pythinker Code CLI",
  "skills": "./skills/",
  "sessionStart": {
    "skill": "using-finance"
  },
  "interface": {
    "displayName": "Pythinker Finance",
    "shortDescription": "Market data and financial analysis workflows"
  }
}
```

Supported fields:

| Field | Description |
| --- | --- |
| `name` | Required plugin id. Must match `[a-z0-9][a-z0-9_-]{0,63}` |
| `version`, `description`, `keywords`, `author`, `homepage`, `license` | Display metadata |
| `interface` | Fields shown in `/plugins`: `displayName`, `shortDescription`, `longDescription`, `developerName`, `websiteURL` |
| `skills` | One or more `./` directory paths containing Agent Skills |
| `agents` | One or more `./` directory paths containing agent profiles |
| `sessionStart.skill` | Loads the specified plugin Skill into the main agent when a new or resumed session starts |
| `skillInstructions` | Additional instructions appended whenever a Skill from this plugin is loaded |
| `systemPrompt` | Inline instructions added to the agent system prompt while the plugin is enabled |
| `systemPromptPath` | A `./` path to a UTF-8 file containing system-prompt instructions |
| `commands` | One or more `./` directory or Markdown-file paths that register slash commands |
| `hooks` | Hook rules that run on matching lifecycle events while the plugin is enabled |
| `mcpServers` | Inline MCP server declarations. Servers are enabled by default and can be managed from `/plugins` |

When `skills` is omitted, a root `SKILL.md` becomes the plugin's single Skill. When `agents` is omitted, an `agents/` directory is discovered automatically. Every declared path must start with `./` and remain inside the plugin root after symbolic-link resolution.

Fields such as `tools`, `apps`, `inject`, `configFile`, and `bootstrap` are not supported. They appear as compatibility diagnostics and are not run.

### System-prompt instructions

Use `systemPrompt` for short inline instructions or `systemPromptPath` for a file inside the plugin root. If both are present, Pythinker Code CLI combines the inline text first and the file second.

Each field has a 32 KB UTF-8 limit. One prompt build accepts up to 64 KB from all enabled plugins. Contributions above either limit are skipped with a diagnostic or warning.

Default agent templates include these instructions automatically. A custom `SYSTEM.md` or agent file can place them with `${plugin_sections}`. Do not add `${plugin_sections}` when `${base_prompt}` already includes the default plugin block. See [Custom agents and SYSTEM.md](./agents.md#overriding-the-main-agent-s-system-prompt-with-system-md).

## Skills and session start

Plugin Skills use the same `SKILL.md` format as ordinary [Agent Skills](./skills.md). A typical directory structure:

```text
my-plugin/
  pythinker.plugin.json
  skills/
    using-my-plugin/
      SKILL.md
    another-workflow/
      SKILL.md
```

`sessionStart.skill` loads a plugin Skill into the main agent at session start, making it suitable for initialization instructions, workflow rules, or mapping terminology from other tools to Pythinker Code CLI. It only injects text; it does not execute code.

Regardless of how a Skill is loaded (`sessionStart.skill`, `/skill:<name>`, or automatic model invocation), `skillInstructions` appears alongside that plugin's Skill.

## Plugin agents

Declare one or more `./` directories in `agents`, or add an `agents/` directory at the plugin root. Its Markdown files use the [custom agent format](./agents.md#custom-agents).

Plugin agents have the lowest file-source priority. User, extra, project, and `--agent-file` profiles win on name conflicts. Replacing a built-in profile still requires `override: true` in its frontmatter.

## Plugin slash commands

The `commands` field accepts a `./` directory, a Markdown file, or an array of either. Directories are scanned recursively for Markdown files.

```json
{
  "name": "pythinker-finance",
  "commands": "./commands/"
}
```

A command file contains optional frontmatter followed by the prompt body:

```markdown
---
description: Summarize a company's latest financials
---

Summarize the latest financials for $ARGUMENTS.
```

Commands use the plugin id as their namespace. The example registers `/pythinker-finance:<command-name>`. The `name` frontmatter field overrides the name derived from the file path. The `description` field falls back to the first non-empty body line.

Text after the command replaces every `$ARGUMENTS` token. If the body has no token, the CLI appends the text as `ARGUMENTS: <text>`.

## MCP servers in plugins

When a plugin needs tool capabilities, it can declare `mcpServers` in its manifest, using the [MCP](./mcp.md) schema.

Stdio server (local command):

```json
{
  "mcpServers": {
    "finance": {
      "command": "uvx",
      "args": ["pythinker-finance-mcp"]
    }
  }
}
```

HTTP server (remote service):

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://example.com/mcp"
    }
  }
}
```

For stdio servers, `command` can be a command on `PATH` or a path starting with `./` inside the plugin root. `cwd` must also stay inside the plugin root. Local server processes receive `PYTHINKER_CODE_HOME` and `PYTHINKER_PLUGIN_ROOT` in their environment.

Plugin MCP servers start after `/reload` or in a new session. To enable or disable a server:

```sh
/plugins mcp disable pythinker-finance finance
/reload

/plugins mcp enable pythinker-finance finance
/reload
```

## Hooks in plugins

The `hooks` field accepts the same `event`, `matcher`, `command`, and `timeout` fields as a [`[[hooks]]` rule in `config.toml`](./hooks.md#configuration):

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "Bash",
      "command": "node ./hooks/check-bash.mjs",
      "timeout": 5
    }
  ]
}
```

Plugin hooks run only while the plugin is enabled. Each hook uses the plugin root as its working directory and receives `PYTHINKER_CODE_HOME` and `PYTHINKER_PLUGIN_ROOT`.

## Security model

Plugins have a limited loading scope:

- Installing a plugin does not run its scripts, hooks, commands, or tool runtimes
- Zip extraction rejects absolute paths, parent-directory traversal, and symbolic-link escapes
- Component, executable, working-directory, and repository-subdirectory paths must remain inside the plugin root
- Hook and MCP declarations must pass their configuration schemas before activation
- MCP servers from enabled plugins start after `/reload` or in a new session and can be disabled individually from `/plugins`
- Broken manifests, unsupported components, unsafe paths, and rejected placeholders appear in `/plugins info <id>` diagnostics and do not affect other sessions

## Next steps

- [Agent Skills](./skills.md) — File format and frontmatter field reference for Skills
- [Custom agents and SYSTEM.md](./agents.md) — Agent profile format and prompt variables
- [Hooks](./hooks.md) — Hook events and result handling
- [MCP](./mcp.md) — Full schema and permission configuration for plugin MCP servers
