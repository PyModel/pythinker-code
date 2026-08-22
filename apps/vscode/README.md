# Pythinker Code

AI coding assistant for VS Code, built for long-context workflows and complex coding tasks.

## Features

- **Works alongside you**: Pythinker autonomously explores your codebase, reads and writes code, and runs terminal commands with your permission
- **Thinking controls**: Toggle reasoning or choose a model-supported thinking effort
- **Provider-aware models**: Distinguish and select same-named models across configured providers
- **Native editor integration**: Review AI-proposed changes directly in VS Code's diff viewer
- **MCP support**: Extend capabilities with Model Context Protocol servers
- **Slash commands**: Quick actions like `/init` to analyze your project and `/compact` to manage context

## Install

Pythinker Code requires VS Code 1.100.0 or later.

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pymodel.pythinker)
2. Open a folder in VS Code
3. Click the Pythinker icon in the Activity Bar
4. Sign in, or use a provider already configured in the shared `config.toml`

The extension runs the Pythinker Code Node SDK in the VS Code Extension Host.
When the extension and the Pythinker Code terminal app resolve to the same
`PYTHINKER_CODE_HOME`, they share `config.toml`, MCP configuration, login
state, and sessions. The system-level `PYTHINKER_CODE_HOME` environment
variable is supported; there is no separate VS Code setting for it. Do not run
the same session from both applications at the same time, because
cross-process session locking is not guaranteed.

### Extension development

The F5 launch profile ("Extension Development Host (isolated)") runs against a
disposable `PYTHINKER_CODE_HOME` at `.tmp/vscode-extension-dev/pythinker-home`,
recreated empty on every launch by `scripts/prepare-dev.mjs`. It does **not**
read your real `~/.pythinker-code/config.toml`.

To start the dev extension with your real providers and models, use the
"(seeded config)" launch profile or `pnpm run dev:prepare:seeded`. It copies your
real `config.toml` verbatim into the disposable dev home, which duplicates every
secret it contains — API keys and any embedded provider auth metadata — into a
file under `.tmp/` (mode `0600` where supported). Credential stores, session
data, and `mcp.json` stay in the real home. The isolated default remains unchanged.

Note: the engine watches `config.toml` and reloads itself on change, but the
extension has no config-change subscription. The model picker and Models section
render Zustand state — no RPC — so they update only on webview reinitialization
or extension-owned provider changes that emit `ProvidersChanged`. The raw
Config File tab rereads the TOML display when opened.

## Docs

Full documentation is available at [pymodel.github.io/pythinker-code](https://pymodel.github.io/pythinker-code/).

## License

[Apache-2.0](LICENSE)
