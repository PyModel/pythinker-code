---
title: Pythinker Code, the terminal-native AI engineering agent
description: Install Pythinker Code, an AI coding agent for your terminal.
---

# Pythinker Code

**Think first, then code.**

Pythinker Code is an AI engineering agent for your terminal. It reads your repository, edits files, runs commands, and iterates until the job is done.

It is free and available for macOS, Linux, and Windows.

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
brew install pymodel/tap/pythinker-code
```

### Nix

```sh
nix run github:PyModel/pythinker-code
```

### npm

```sh
npm install -g @pymodel/pythinker-code
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

- [Documentation](https://pymodel.github.io/pythinker-code/)
- [Getting started](https://pymodel.github.io/pythinker-code/guides/getting-started)
- [Configuration](https://pymodel.github.io/pythinker-code/configuration/config-files)
- [Command reference](https://pymodel.github.io/pythinker-code/reference/pythinker-command)
- [GitHub repository](https://github.com/PyModel/pythinker-code)
- [npm package](https://www.npmjs.com/package/@pymodel/pythinker-code)
