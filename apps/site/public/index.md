---
title: Pythinker Code, the terminal-native AI engineering agent
description: Install Pythinker Code, an open-source AI coding agent for your terminal.
---

# Pythinker Code

**Think first, then code.**

Pythinker Code is an open-source AI engineering agent for your terminal. It reads your repository, edits files, runs commands, and iterates until the job is done.

It is free, MIT licensed, and available for macOS, Linux, and Windows.

## Install

### macOS or Linux

```sh
curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://code.pythinker.com/pythinker-code/install.ps1 | iex
```

### Homebrew

```sh
brew install pythoughts-labs/tap/pythinker-code
```

### Nix

```sh
nix run github:Pythoughts-labs/pythinker-code
```

### npm

```sh
npm install -g @pythoughts/pythinker-code
```

Verify the installation with `pythinker --version`.

## Quick start

1. Run `pythinker` in your project.
2. Authenticate with `/login` using Pythinker Code OAuth or an API key.
3. Describe an engineering task and review the agent's work.

## Capabilities

- Run subagents in parallel from one iterative agent loop.
- Connect to editors through Agent Client Protocol (ACP).
- Load Model Context Protocol (MCP) servers with `/mcp-config`.
- Use reusable repository skills and lifecycle hooks.
- Configure Pythinker models or other compatible LLM APIs.

## Resources

- [Documentation](https://pythoughts-labs.github.io/pythinker-code/)
- [Getting started](https://pythoughts-labs.github.io/pythinker-code/guides/getting-started)
- [Configuration](https://pythoughts-labs.github.io/pythinker-code/configuration/config-files)
- [Command reference](https://pythoughts-labs.github.io/pythinker-code/reference/pythinker-command)
- [GitHub repository](https://github.com/Pythoughts-labs/pythinker-code)
- [npm package](https://www.npmjs.com/package/@pythoughts/pythinker-code)
