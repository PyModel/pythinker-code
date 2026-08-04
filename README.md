<div align="center">

# <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/pythinker_animated.svg" alt="Pythinker logo" width="34" align="top"> Pythinker Code

### *Think first, then code. Your terminal-native AI engineering agent.*

**An intelligent agent that reads your codebase, edits files, runs shell commands, searches the web, and iterates until the job is done.**
**Powered by [Pythinker models](https://pythinker.com) — compatible with other LLM providers. All from the shell you already live in.**

<br />

[![npm version](https://img.shields.io/npm/v/@pythoughts/pythinker-code?style=for-the-badge&logo=npm&logoColor=white&color=CB3837&label=pythinker-code)](https://www.npmjs.com/package/@pythoughts/pythinker-code)
[![Downloads](https://img.shields.io/npm/dm/@pythoughts/pythinker-code?style=for-the-badge&logo=npm&logoColor=white&color=16a34a&label=downloads)](https://www.npmjs.com/package/@pythoughts/pythinker-code)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://github.com/Pythoughts-labs/pythinker-code/blob/main/package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-16a34a.svg?style=for-the-badge)](https://github.com/Pythoughts-labs/pythinker-code/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Pythoughts-labs/pythinker-code/ci.yml?branch=main&label=CI&style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/Pythoughts-labs/pythinker-code/actions/workflows/ci.yml?query=branch%3Amain)

[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ACP ready](https://img.shields.io/badge/ACP-ready-7c3aed.svg?style=flat-square)](https://agentclientprotocol.com/)
[![MCP tools](https://img.shields.io/badge/MCP-tools-0891b2.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Docs](https://img.shields.io/badge/docs-online-0284c7.svg?style=flat-square)](https://pythoughts-labs.github.io/pythinker-code/)
[![Homepage](https://img.shields.io/badge/home-code.pythinker.com-ec4899.svg?style=flat-square)](https://code.pythinker.com)

<br />

<a href="https://code.pythinker.com">Website</a> &nbsp;·&nbsp;
<a href="#quick-start">Quick Start</a> &nbsp;·&nbsp;
<a href="#features">Features</a> &nbsp;·&nbsp;
<a href="#ide-integration-via-acp">IDE Integration</a> &nbsp;·&nbsp;
<a href="#mcp-tooling">MCP</a> &nbsp;·&nbsp;
<a href="#architecture">Architecture</a> &nbsp;·&nbsp;
<a href="#development">Development</a>

<br /><br />

<img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/init.webp" alt="Pythinker Code terminal demo" width="860">

</div>

---

## What is Pythinker?

**Pythinker Code**is an open-source AI engineering agent that lives in your terminal. Give it a task — refactor a module, trace a bug, scaffold a feature — and it plans, executes tools, observes results, and keeps going until you are satisfied. It runs against **your repo, the shell, the web, and MCP tools**, with the model of your choice.

It ships with first-class subagents for focused work — `coder` for scoped edits, `explore` for codebase reconnaissance, and `plan` for implementation design — all dispatched in parallel, isolated contexts from a single iterative loop.

It speaks the [**Agent Client Protocol (ACP)**](https://agentclientprotocol.com/), so it slots cleanly into ACP-aware editors like Zed and JetBrains. It loads [**Model Context Protocol (MCP)**](https://modelcontextprotocol.io/) servers, so the same tools your other agents use just work. And it's hackable: subagents, skills, hooks, and plugins are all first-class extension points.

> **Plan · Execute · Verify · Iterate.**One agent, one shell, one workflow. No tab-switching. No context loss. No magic.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### Terminal-First

A purpose-built TUI tuned for long, focused agent sessions. Single-binary install, no Node.js required for end users, ready in milliseconds.

</td>
<td width="50%" valign="top">

### Subagents & Skills

Dispatch `coder`, `explore`, and `plan` subagents in parallel, isolated contexts. Load reusable repo-local instructions via `/skill:<name>`.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ACP IDE Integration

Run `pythinker acp` and any [Agent Client Protocol](https://agentclientprotocol.com/) editor — Zed, JetBrains, and more — gets a full Pythinker session inline.

</td>
<td width="50%" valign="top">

### MCP Tool Loading

Add and authenticate MCP servers conversationally with `/mcp-config`. Plus a rich plugin ecosystem: skills, MCP servers, and data sources from the marketplace or GitHub.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Trust & Control

Approval flows to review tool calls before they run, a granular permission model, and lifecycle hooks to gate risky calls, audit decisions, and wire automation.

</td>
<td width="50%" valign="top">

### Bring Your Own Model

Works out of the box with [Pythinker models](https://pythinker.com); configurable for other compatible LLM APIs.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Web & Dashboard UIs

A companion browser interface (`apps/pythinker-web`) and a session dashboard for replaying and debugging agent sessions (`apps/dashboard`).

</td>
<td width="50%" valign="top">

### Video Input

Drop screen recordings into the conversation — let the agent *see* what is hard to describe.

</td>
</tr>
</table>

---

## Quick Start

Pythinker ships **native installers**— no Node.js prerequisite. Pick the row that matches your OS:

| Platform | Recommended install | Source |
|---|---|---|
| <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/apple.svg" width="16" height="16" alt="macOS" align="top"> <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/linux.svg" width="16" height="16" alt="Linux" align="top"> **macOS / Linux**| `curl -fsSL https://code.pythinker.com/pythinker-code/install.sh \| bash` | [code.pythinker.com](https://code.pythinker.com) |
| <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/homebrew.svg" width="16" height="16" alt="Homebrew" align="top"> **Homebrew**| `brew install pythoughts-labs/tap/pythinker-code` | Homebrew |
| <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/windows11.svg" width="16" height="16" alt="Windows" align="top"> **Windows (PowerShell)**| `irm https://code.pythinker.com/pythinker-code/install.ps1 \| iex` | [code.pythinker.com](https://code.pythinker.com) |
| <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/nixos.svg" width="16" height="16" alt="Nix" align="top"> **Nix**| `nix run github:Pythoughts-labs/pythinker-code` | flake |
| <img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/icons/npm.svg" width="16" height="16" alt="npm" align="top"> **npm / pnpm fallback**| `npm install -g @pythoughts/pythinker-code` | requires Node.js ≥ 26.4.0 |

> [!NOTE]
> **Windows:**install [Git for Windows](https://gitforwindows.org/) before first launch — Pythinker Code uses the bundled Git Bash as its shell. For a custom Git Bash location, set `PYTHINKER_SHELL_PATH` to the absolute path of `bash.exe`.

After install, open a **new shell**:

```sh
pythinker --version            # confirm install
```

### Authenticate

```sh
cd your-project
pythinker
```

On first launch, run `/login` and choose **[Pythinker Code OAuth](https://pythinker.com/code)**or an **[API key from the console](https://pythinker.com/code/console)**.

### Try it out

```
Take a look at this project and explain its main directories.
```

```
Find where authentication is handled and add a unit test for the token refresh path.
```

```
Refactor the error handling in src/api/ to use a shared Result type — keep the diff minimal.
```

| Command | Description |
|---------|-------------|
| `/login` | Authenticate with OAuth or API key |
| `/mcp-config` | Manage MCP servers conversationally |
| `/skill:<name>` | Invoke an installed skill |
| `/help` | Built-in keyboard shortcut reference |

For upgrade, uninstall, headless/automation usage, and platform-specific notes, see the [Getting Started guide](https://pythoughts-labs.github.io/pythinker-code/guides/getting-started).

---

## IDE Integration via ACP

Pythinker speaks [**Agent Client Protocol**](https://agentclientprotocol.com/) natively. Log in once via the CLI, then point your ACP-compatible editor at `pythinker acp` for a full agent session inside your IDE.

<details>
<summary><b>Configuration for Zed / JetBrains</b></summary>

Add to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "Pythinker Code": {
      "type": "custom",
      "command": "pythinker",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

</details>

Open a new conversation in Zed's Agent panel. For JetBrains setup, troubleshooting, and the full capability matrix, see [Using in IDEs](https://pythoughts-labs.github.io/pythinker-code/guides/ides) and the [`pythinker acp` reference](https://pythoughts-labs.github.io/pythinker-code/reference/pythinker-acp).

<div align="center">
<img src="https://raw.githubusercontent.com/Pythoughts-labs/pythinker-code/main/docs/media/acp-integration.gif" alt="ACP IDE integration demo" width="860">
</div>

---

## MCP Tooling

Pythinker loads [Model Context Protocol](https://modelcontextprotocol.io/) tools so the same servers your other agents use just work — stdio and HTTP transports, OAuth-backed servers, persistent config.

Inside a session, `/mcp-config` manages everything conversationally:

```
/mcp-config              # add, authenticate, test, and remove MCP servers
```

See the [configuration docs](https://pythoughts-labs.github.io/pythinker-code/configuration/config-files) for config-file based setup.

---

## Architecture

Pythinker Code is a **pnpm monorepo**. The CLI consumes capabilities through the SDK and never depends directly on internal engine packages.

<p align="center">
  <img src="docs/media/Architecture.webp" alt="Pythinker Code architecture" width="836" />
</p>

| Package | Role |
|---------|------|
| `apps/pythinker-code` | CLI and terminal UI — the primary user-facing entry point |
| `packages/agent-core` | Unified agent engine: sessions, tools, skills, permissions, plans |
| `packages/kosong` | "Any LLM" — LLM and provider abstraction layer |
| `packages/kaos` | Execution environment and file/process abstractions |
| `packages/server` | Hosts agent sessions over REST + WebSocket (`/api/v1`) |
| `packages/node-sdk` | Public TypeScript SDK for embedding and automation |

---

## Extensibility

Pythinker is a small, extensible runtime — not a monolith. Build on it.

| Extension Point | What it does | Where to look |
|---|---|---|
| **Subagents**| Delegate focused work to `coder`, `explore`, and `plan` agents in isolated contexts | built-in |
| **Skills**| `/skill:<name>` loads reusable, repo-local instructions on demand | bundled & user-defined |
| **Hooks**| Observe or block tool execution; integrate policy or automation | lifecycle hook events |
| **Plugins**| Skills, MCP servers, and data sources from the marketplace or GitHub | plugin ecosystem |
| **SDK**| Embed agent capabilities in your own tools | [`@pythoughts/pythinker-code-sdk`](packages/node-sdk) |

---

## Documentation

| Topic | Link |
|-------|------|
| Getting Started | [guides/getting-started](https://pythoughts-labs.github.io/pythinker-code/guides/getting-started) |
| Interaction & approvals | [guides/interaction](https://pythoughts-labs.github.io/pythinker-code/guides/interaction) |
| Sessions | [guides/sessions](https://pythoughts-labs.github.io/pythinker-code/guides/sessions) |
| IDE integration | [guides/ides](https://pythoughts-labs.github.io/pythinker-code/guides/ides) |
| Configuration | [configuration/config-files](https://pythoughts-labs.github.io/pythinker-code/configuration/config-files) |
| Command reference | [reference/pythinker-command](https://pythoughts-labs.github.io/pythinker-code/reference/pythinker-command) |
| Pythinker Code product | [pythinker.com/code](https://pythinker.com/code) |

---

## Development

### Prepare the workspace

**Requirements:**Node.js ≥ 26.4.0 · pnpm 10.34.3 · Git

```sh
git clone https://github.com/Pythoughts-labs/pythinker-code.git
cd pythinker-code
pnpm install
```

### Common commands

<table>
<tr>
<td valign="top">

**▶ Run & iterate**
```sh
pnpm dev:cli              # CLI in dev mode
pnpm dev:web              # browser UI
pnpm dev:server           # agent server
pnpm dashboard            # session dashboard
```

</td>
<td valign="top">

**Verify**
```sh
pnpm test                 # test suite (Vitest)
pnpm typecheck            # TypeScript check
pnpm lint                 # lint with oxlint
pnpm build                # build all packages
```

</td>
</tr>
</table>

---

## Project Layout

```
pythinker-code/
├──  apps/
│   ├── pythinker-code/        CLI · TUI · ACP · the primary entry point
│   ├── pythinker-web/         Companion browser UI (Vue 3)
│   └── dashboard/             Session replay & debugging
├──  packages/
│   ├── agent-core/            Unified agent engine: sessions · tools · skills · permissions
│   ├── kosong/                "Any LLM" provider abstraction
│   ├── kaos/                  Execution environment & file/process abstractions
│   ├── server/                REST + WebSocket session host (/api/v1)
│   └── node-sdk/              Public TypeScript SDK
└──  per-package test suites (Vitest)
```

---

## Contributing

Contributions are warmly welcome — bug reports, PRs, plugins, skills, and docs all help.

-  Start with [`CONTRIBUTING.md`](CONTRIBUTING.md)
-  See [`SECURITY.md`](SECURITY.md) for responsible disclosure
-  **Discuss first**for new features, large refactors, or API changes — open an issue before coding
-  **Follow Conventional Commits**(`feat:`, `fix:`, `docs:`, …) and include a changeset (`pnpm changeset`) when your PR affects release artifacts
-  **Understand your diff**— AI-assisted PRs are held to the same standard as hand-written ones

If Pythinker helps you, **a  on GitHub goes a long way.**

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for the full text.

Our TUI is built on [`pi-tui`](https://github.com/earendil-works/pi-mono/tree/main/packages/tui) — thank you to the authors for their excellent work.

<br />

<div align="center">

**Built with  for engineers who live in the terminal.**

[ code.pythinker.com](https://code.pythinker.com) &nbsp;·&nbsp;
[ npm](https://www.npmjs.com/package/@pythoughts/pythinker-code) &nbsp;·&nbsp;
[ GitHub](https://github.com/Pythoughts-labs/pythinker-code) &nbsp;·&nbsp;
[ Docs](https://pythoughts-labs.github.io/pythinker-code/) &nbsp;·&nbsp;
[ ACP](https://agentclientprotocol.com/) &nbsp;·&nbsp;
[ MCP](https://modelcontextprotocol.io/)

<p align="center">
  <em>Thanks for visiting  Pythinker!</em>
</p>

</div>
