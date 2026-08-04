# Plugins

Plugins package reusable Pythinker Code CLI capabilities into installable units — they can add [Agent Skills](./skills.md), agent profiles, output styles, MCP servers, and Language Server Protocol (LSP) servers that provide code intelligence. They are ideal for sharing workflows with a team, connecting to external services, or installing extensions from Pythinker and compatible Claude Code marketplaces.

Pythinker Code CLI applies a conservative loading strategy for plugins: installing a plugin does not execute any Python, Node.js, shell, hook, or command scripts it contains.

## Installation and management

Run `/plugins` in the terminal interface to open the plugin manager, where you can perform all routine operations. Common keys:

| Key | Action |
| --- | --- |
| `Enter` | Open the selected installed item, or install or update the selected marketplace plugin |
| `Space` | Enable or disable an installed plugin |
| `M` | Manage MCP servers for the selected installed plugin |
| Type text | Search the current marketplace by plugin metadata and source |
| `PgUp` or `PgDn` | Move through marketplace pages |
| `←` or `Esc` | Go back to the previous level |

Each marketplace page shows up to four plugins and keeps the selected plugin's details visible. When a search is active, `Backspace` edits it and the first `Esc` clears it; press `Esc` again to leave the marketplace. An installed plugin with a newer version or revision shows `update <local> → <latest>`, an up-to-date one shows `installed` with its version when available, and an uninstalled one shows `install`. Entries that cannot be installed remain visible with an explanation.

Opening **Marketplace** without a source lets you choose **Pythinker**, **Anthropic**, or **Custom marketplace**. Pythinker loads the official and curated Pythinker catalog. Anthropic loads the official Claude Code plugin catalog. A custom source can be a local marketplace directory or JSON file, a direct JSON URL, a GitHub `owner/repository` shorthand, or a GitHub repository or tree URL.

You can also open a source directly:

```sh
/plugins marketplace pythinker
/plugins marketplace anthropic
/plugins marketplace ./example-marketplace
/plugins marketplace example-org/example-plugins
```

Pythinker marketplace JSON and Claude Code `.claude-plugin/marketplace.json` files are detected automatically. For a local directory or GitHub repository, Pythinker Code CLI reads `.claude-plugin/marketplace.json` from the marketplace root, so relative Claude plugin paths can resolve within that repository. A catalog-level `metadata.pluginRoot` is prepended to each relative plugin source. A direct remote JSON URL has no repository context; relative plugin entries in that catalog remain visible but unavailable. Claude `npm`, SSH, generic Git, and non-GitHub repository sources are also shown as unavailable instead of being silently omitted.

You can use slash commands for the remaining operations:

| Command | Description |
| --- | --- |
| `/plugins` | Open the interactive plugin manager |
| `/plugins list` | List installed plugins |
| `/plugins install <path-or-url>` | Install from a local directory, zip URL, or GitHub repository URL |
| `/plugins marketplace [source]` | Choose a marketplace or browse the supplied alias, path, JSON URL, or GitHub repository |
| `/plugins info <id>` | View plugin details and diagnostics |
| `/plugins enable <id>` | Enable a plugin |
| `/plugins disable <id>` | Disable a plugin |
| `/plugins remove <id>` | Remove a plugin (requires confirmation) |
| `/plugins reload` | Reload `installed.json` and all plugin manifests |
| `/plugins mcp enable <id> <server>` | Enable an MCP server declared by a plugin |
| `/plugins mcp disable <id> <server>` | Disable an MCP server declared by a plugin |

The plugin manager shows the installation source and a trust badge for each install: `pythinker-official` (from an official Pythinker address), `curated` (from a curated Pythinker address), or `third-party` (everything else). Marketplace ownership does not grant Pythinker trust, so plugins from Anthropic's official catalog still show `third-party` under Pythinker trust.

### Installing from GitHub

Use `/plugins install <url>` to install directly from a GitHub repository. Four URL forms are supported:

- `https://github.com/<owner>/<repo>`: Install the latest release; falls back to the default branch if no release exists
- `https://github.com/<owner>/<repo>/tree/<ref>`: Install a specific branch, tag, or short commit SHA
- `https://github.com/<owner>/<repo>/releases/tag/<tag>`: Pin to a specific tag
- `https://github.com/<owner>/<repo>/commit/<sha>`: Pin to a specific commit

Network requests only go through `github.com` redirects and `codeload.github.com` downloads; `api.github.com` is not called.

### Notes

- Plugin changes only take effect for new sessions. After installing, enabling/disabling, or removing a plugin, run `/reload` to reload plugins or `/new` to start a new session; the current session will not update.
- Local installations are copied to `$PYTHINKER_CODE_HOME/plugins/managed/<id>/`, and the CLI always runs from this managed copy. Editing the original source directory after installation has no effect; you must reinstall.
- Removing a plugin only deletes the installation record; the managed copy and original source files remain on disk.
- Plugins are currently installed per-user and apply to all projects; project-level installation scope is not yet supported.

## Pythinker Datasource

Pythinker Datasource is the official Pythinker Code data plugin. It lets you query financial market data, macroeconomic indicators, corporate registration records, academic literature, and Chinese laws and regulations in natural language — no manual API calls or data account registration required.

### Installation

You must first complete OAuth login with a Pythinker Code account via `/login`. The plugin relies on local credentials to access data services.

1. Run `/plugins` and select **Marketplace**
2. Find **Pythinker Datasource** and press `Enter` to install
3. After installation completes, run `/reload` to activate the plugin

The current latest version is v3.2.0. The plugin does not update automatically — to upgrade to a newer version, repeat the installation steps above.

### How to Use

Once installed, describe your need in natural language and Pythinker Code will automatically invoke the data capabilities. You can also explicitly trigger the data query skill with `/skill:pythinker-datasource`.

### What You Can Do

**Live market research**: Want to run a quantitative analysis on a stock? Pull three years of daily closing prices, MACD, and KDJ signals in a single query — no third-party data platforms needed.

**Cross-country macro comparison**: Studying supply-chain shifts across China, India, and Vietnam? Get complete GDP growth, trade volume, and demographic time-series from World Bank data spanning 50+ years, all in one go.

**Pre-contract risk check**: Need to vet a counterparty fast? Type the company name and instantly get business registration, equity structure, litigation disputes, and credit blacklist status — right when you need it.

**Literature review acceleration**: Tracing the research arc of RLHF? Get the most-cited papers, key authors, and core findings in seconds, so your literature review outline takes shape in half the time.

**On-the-spot legal lookup**: Stuck on which statute governs a residence-right contract dispute? Pinpoint the relevant Civil Code articles — full text, authority level, and validity — then pull a few comparable precedents to back them up, without digging through statute databases.

### Coverage

| Category | Scope |
|---|---|
| Stock market data | A-shares, HK, US, and major global markets — real-time/historical prices, technical indicators, financial statements, stock screening |
| Macroeconomic data | World Bank data for 189 countries, 50+ years of time series (GDP, trade, population, climate, and more) |
| Corporate data | Business registration, equity chain, legal risk, and related-entity graph for mainland Chinese companies |
| Academic literature | Millions of papers across physics, mathematics, CS, quantitative finance, economics — including preprints |
| Legal | Chinese laws, regulations, and judicial cases — semantic/keyword search and detail lookup for statutes across all authority levels (constitution, laws, judicial interpretations, departmental rules), plus ordinary and authoritative case search |

### Notes

- Data queries are billed per call and consume Pythinker Code account credits
- The plugin provides read-only queries; no write or trading functionality is available
- Technical indicators and real-time prices are only available during active trading hours
- AI-generated output is for reference only and does not constitute investment or business advice

## Plugin manifest

A direct directory, zip, or GitHub install needs a plugin manifest at one of these locations:

```text
<plugin_root>/pythinker.plugin.json
<plugin_root>/.pythinker-plugin/plugin.json
<plugin_root>/.claude-plugin/plugin.json
```

When more than one exists, Pythinker Code CLI uses them in the order shown above and reports the lower-priority manifest as shadowed. A marketplace install may omit a manifest when its catalog entry supplies the plugin identity and component declarations. A Claude `.claude-plugin/plugin.json` manifest can use a top-level `displayName`; native Pythinker manifests use `interface.displayName`.

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
| `name` | Required for direct installs; serves as the plugin id. A marketplace definition supplies this value instead. The id must match `[a-z0-9][a-z0-9_-]{0,63}` |
| `version`, `description`, `keywords`, `tags`, `category`, `author`, `homepage`, `repository`, `license` | Display and discovery metadata |
| `interface` | Fields shown in `/plugins`: `displayName`, `shortDescription`, `longDescription`, `developerName`, `websiteURL` |
| `defaultEnabled` | Initial enabled state on first install. Updating or reinstalling preserves the current enabled state |
| `skills` | One or more `./` directory paths containing Agent Skills |
| `agents` | One or more `./` Markdown files or directories containing agent profiles |
| `outputStyles` | One or more `./` Markdown files or directories containing output styles |
| `sessionStart.skill` | Loads the specified plugin Skill into the main agent when a new or resumed session starts |
| `skillInstructions` | Additional instructions appended whenever a Skill from this plugin is loaded |
| `mcpServers` | Inline declarations, `./` JSON paths, or arrays of both. MCP servers are enabled by default and can be managed from `/plugins` |
| `lspServers` | Inline declarations, `./` JSON paths, or arrays of both for LSP servers |

The conventional `skills/`, `agents/`, and `output-styles/` directories are discovered automatically. If neither `skills` nor `skills/` is present, a root `SKILL.md` is treated as one Skill root. Every discovered component must remain within the plugin root after symbolic link resolution. Explicit component paths must also start with `./` and point to the expected file or directory type.

Claude marketplace definitions can provide supported components even when the plugin has no manifest. By default, Pythinker Code CLI combines supported manifest and marketplace declarations. For an entry with `strict: false`, it uses only the marketplace's component declarations. The definition is retained with the installed plugin, so manifestless components remain available after restart. Updates preserve the plugin's enabled state and its per-server MCP choices.

Pythinker Code CLI loads the supported parts of Claude plugins: `skills`, `agents`, `outputStyles`, `mcpServers`, and `lspServers`. Runtime extensions such as `tools`, `commands`, `hooks`, `apps`, `workflows`, `monitors`, `themes`, and `channels` appear as compatibility diagnostics and are not run.

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

Regardless of how a Skill is loaded (`sessionStart.skill`, `/skill:<name>`, or automatic model invocation), `skillInstructions` appears alongside that plugin's Skill. Paths declared through `agents` add reusable [agent profiles](./agents.md), while `outputStyles` adds prompt-based output styles when the plugin is enabled.

## MCP servers in plugins

When a plugin needs real tool capabilities, it can declare `mcpServers` in its manifest or marketplace definition, reusing the [MCP](./mcp.md) schema.

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

When `mcpServers` is omitted, a root `.mcp.json` file is loaded automatically. The same rule applies to `lspServers` and `.lsp.json`. Each file may contain the server map directly or wrap it in an `mcpServers` or `lspServers` object.

For stdio servers, `command` can be a command on `PATH` or a path starting with `./` within the plugin root directory. `cwd` likewise must start with `./` and remain within the plugin root directory; otherwise the server is ignored. In MCP and LSP declarations, `${CLAUDE_PLUGIN_ROOT}` expands to the installed plugin root. Local server processes also receive `CLAUDE_PLUGIN_ROOT` and `PYTHINKER_PLUGIN_ROOT` in their environment; declarations containing any other unresolved placeholder are ignored.

Plugin MCP servers only start in new sessions. To enable or disable a server:

```sh
/plugins mcp disable pythinker-finance finance
/new

/plugins mcp enable pythinker-finance finance
/new
```

LSP servers are active in new sessions while their plugin is enabled.

## Security model

Plugins have a limited loading scope:

- Installing a plugin does not run its scripts, hooks, commands, or tool runtimes
- Zip extraction rejects absolute paths, parent-directory traversal, and symbolic-link escapes
- Component, executable, working-directory, and repository-subdirectory paths must remain inside the plugin root
- MCP and LSP declarations must pass their configuration schemas before activation
- MCP and LSP servers from enabled plugins only start in new sessions; MCP servers can be disabled individually from `/plugins`
- Broken manifests, unsupported components, unsafe paths, and rejected placeholders appear in `/plugins info <id>` diagnostics and do not affect other sessions

## Next steps

- [Agent Skills](./skills.md) — File format and frontmatter field reference for Skills
- [MCP](./mcp.md) — Full schema and permission configuration for plugin MCP servers
