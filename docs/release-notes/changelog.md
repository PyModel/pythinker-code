---
outline: 2
---

# Changelog

This page documents the changes in each Pythinker Code CLI release.

## 0.5.1 (2026-08-03)

### Other

- Point the README install commands at the canonical code.pythinker.com URLs and correct the npm install path's Node.js floor to 26.4.0.

## 0.5.0 (2026-08-03)

### Bug Fixes

- Ship the native single-binary bundles that 0.4.0's release run failed to produce, including unsigned macOS bundles when signing credentials are unavailable.

### Refactors

- Release pipeline hardening: idempotent npm publish, refreshed Nix dependency hash, monorepo dependency-version sync, strict pre-push quality gates, and Dependabot configuration.

## 0.4.0 (2026-08-03)

### Features

- Shift-Tab now cycles the thinking effort for the current model, and the prompt-box border tints with a per-effort color gradient; plan mode moves to the `/plan` command.

### Bug Fixes

- Continue goal pursuit when a goal turn hits the per-turn step limit instead of stalling.
- Count validation-rejected tool calls toward the repeat circuit breaker so the model cannot re-issue the same invalid call indefinitely.
- Fail fast on quota-exhausted 429 responses instead of retrying until the retry budget is spent.
- Restore the real Kimi coding-plan model ids in the ACP thinking-toggle list.

### Other

- The provider base URL is now required configuration: there is no default hosted endpoint, so point the CLI at your own OpenAI-compatible backend.
- Dependency security updates.

## 0.3.0 (2026-08-03)

### Features

- Add the `/update` slash command (alias `/upgrade`): it checks the CDN for a newer version and installs it in the background, falling back to a copyable command for installs that cannot self-update (e.g. Homebrew). `pythinker doctor` now reports whether auto-update is on, off via `tui.toml [upgrade].auto_install`, or disabled by `PYTHINKER_CODE_NO_AUTO_UPDATE`.

## 0.2.0 (2026-08-03)

### Features

- Add persistent named agent teams with background teammate spawning, shared task scopes, direct and broadcast messaging, assignment delivery, shutdown coordination, and native terminal identities.
- Add project, user, and namespaced plugin subagent profiles with per-profile turn limits and persistent memory, context-fork workers, per-agent model and working-directory overrides, and Git worktree isolation with native terminal status.
- Add catalog-backed provider connections with interactive or environment-referenced credentials, live model discovery, provider-aware model selection, and model-specific thinking controls.
- Add persisted file checkpoints with preview and recovery-backed code or conversation rewind through the SDK, CLI, and TUI.
- Add configurable Global and Chat TUI keybindings with unbinding, two-key chords, reserved shortcuts, dynamic help labels, template creation, and editor-backed reload.
- Add validated session and persistent workspace directories with SDK, CLI, and TUI management.
- Add Anthropic Claude Code marketplace browsing and installation with searchable source selection and install-definition support.
- Add provider-native Fast mode controls for supported OpenAI and Anthropic models.
- Add an agent-callable Config tool for approved, validated reads and writes of supported Pythinker settings.
- Expose the precedence-resolved agent profile catalog through the SDK and a searchable TUI command.
- Expose the model-visible context breakdown through the SDK and a `/context` TUI report.
- Expose files loaded by Read through the SDK and a `/files` TUI command.
- Show Dynamic Workflow in a coral-framed mission-control panel with live per-agent progress, and let workflow agents run without an automatic timeout.

### Polish

- Preserve full truncated Bash output on disk, interpret informational exit codes, and expand destructive-command warnings in the terminal approval flow.
- Add clearer TUI startup status, effort heat, Dynamic Workflow progress colors, and a brighter dark-theme primary.

