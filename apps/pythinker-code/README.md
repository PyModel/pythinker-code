# @pythoughts/pythinker-code

> The Starting Point for Next-Gen Agents

[![npm](https://img.shields.io/npm/v/@pythoughts/pythinker-code)](https://www.npmjs.com/package/@pythoughts/pythinker-code) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)  [![Docs](https://img.shields.io/badge/docs-online-blue)](https://pythoughts-labs.github.io/pythinker-code/)

<p align="center">
  <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/init.webp" alt="Pythinker Code terminal demo" width="860">
</p>

## What is Pythinker Code CLI

Pythinker Code CLI is an AI coding agent that runs in your terminal. It can read and edit code, run shell commands, search files, fetch web pages, and choose the next step based on the feedback it receives. It works out of the box with Pythoughts's Pythinker models and can also be configured to use other compatible providers.

## Install

The recommended install path is the official script. It does not require Node.js to be installed first.

- **macOS / Linux**:

```sh
curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash
```

- **Windows (PowerShell)**:

```powershell
irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
```

> On Windows, install [Git for Windows](https://gitforwindows.org/) before first launch because Pythinker Code CLI uses the bundled Git Bash as its shell environment. If Git Bash is installed in a custom location, set `PYTHINKER_SHELL_PATH` to the absolute path of `bash.exe`.

Then run it with a new Terminal session:

```sh
pythinker --version
```

### Alternative: npm

If you prefer npm, use Node.js 26.4.0 or later:

```sh
npm install -g @pythoughts/pythinker-code
```

Or with pnpm:

```sh
pnpm add -g @pythoughts/pythinker-code
```

For upgrade and uninstall instructions, see the [Getting Started guide](https://pythoughts-labs.github.io/pythinker-code/guides/getting-started).

## Quick Start

Open a project and start the interactive UI:

```sh
cd your-project
pythinker
```

On first launch, run `/login` inside Pythinker Code CLI and choose either Pythinker Code OAuth or a Pythinker Platform API key. After login, try a first task:

```
Take a look at this project and explain the main directories.
```

## Key Features

- **Single-binary distribution.** Install with one command — no Node.js setup, no PATH gymnastics, no global module conflicts.
- **Blazing-fast startup.** The TUI is ready in milliseconds, so opening a session never feels heavy.
- **Polished TUI.** A carefully tuned interface designed for long, focused agent sessions.
- **Video input.** Drop a screen recording or demo clip into the chat — let the agent watch instead of typing out what's hard to describe in words.
- **AI-native MCP configuration.** Add, edit, and authenticate Model Context Protocol servers conversationally via `/mcp-config` — no hand-editing JSON.
- **Subagents for focused, parallel work.** Dispatch built-in `coder`, `explore`, and `plan` subagents in isolated context windows; the main conversation stays clean.
- **Lifecycle hooks.** Run local commands at key points — gate risky tool calls, audit decisions, fire desktop notifications, wire into your own automation.

## Documentation

- Full docs: https://pythoughts-labs.github.io/pythinker-code/
- Getting Started: https://pythoughts-labs.github.io/pythinker-code/guides/getting-started

## Repository & Issues

- Source: https://github.com/Pythoughts-labs/pythinker-code
- Issues: https://github.com/Pythoughts-labs/pythinker-code/issues
- Security: see SECURITY.md in the main repository

## License

MIT
