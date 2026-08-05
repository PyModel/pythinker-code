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

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pythoughts.pythinker-code)
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

## Docs

Full documentation is available at [pythoughts-labs.github.io/pythinker-code](https://pythoughts-labs.github.io/pythinker-code/).

## License

[Apache-2.0](LICENSE)
