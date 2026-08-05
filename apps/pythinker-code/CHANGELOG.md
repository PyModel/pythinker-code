# @pythoughts/pythinker-code

## 0.9.1

### Patch Changes

- [#24](https://github.com/Pythoughts-labs/pythinker-code/pull/24) [`ae01098`](https://github.com/Pythoughts-labs/pythinker-code/commit/ae01098b862a567552c7d49a6d5bd1808077a794) - Fix the Dynamic Workflow card showing `[object Object]`, phantom extra agent rows, and tool labels fused into streamed text when a workflow is called with object items.

- [#24](https://github.com/Pythoughts-labs/pythinker-code/pull/24) [`ae01098`](https://github.com/Pythoughts-labs/pythinker-code/commit/ae01098b862a567552c7d49a6d5bd1808077a794) - Show Dynamic Workflow member progress from the observed stage only, so a running subagent no longer sits at 99% for the rest of its run.

## 0.9.0

### Minor Changes

- [#22](https://github.com/Pythoughts-labs/pythinker-code/pull/22) [`45be822`](https://github.com/Pythoughts-labs/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32) - Name the managed OAuth provider after the platform that serves it. It is reached over `auth.kimi.com` and `api.kimi.com`, but it was registered as `managed:pythinker-code`, which read as a first-party service in a client that talks to several providers. The provider id is now `managed:kimi-code`, its models are aliased `kimi-code/*`, and its credentials are stored under `oauth/kimi-code`.

  This is a breaking change for an existing config: the previous entries are not rewritten, so run `pythinker login` once to provision the managed provider under its current name, then remove the stale `managed:pythinker-code` entry.

- [#22](https://github.com/Pythoughts-labs/pythinker-code/pull/22) [`45be822`](https://github.com/Pythoughts-labs/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32) - Resolve a workspace's skills without opening a session, so an editor panel can list them before its first message.

### Patch Changes

- [#22](https://github.com/Pythoughts-labs/pythinker-code/pull/22) [`45be822`](https://github.com/Pythoughts-labs/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32) - Add an SDK routine that imports a catalog provider and its models into the persisted config, and use it for the CLI provider import so both entry points preserve existing defaults the same way.

- [#22](https://github.com/Pythoughts-labs/pythinker-code/pull/22) [`45be822`](https://github.com/Pythoughts-labs/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32) - Stop the fixed-layout TUI anchoring its first frames to the shell cursor, which pushed the panel border into scrollback.

## 0.8.1

### Patch Changes

- [`b5b7b97`](https://github.com/Pythoughts-labs/pythinker-code/commit/b5b7b976df2a5fddd28a15ad034a2bd7cc8babb7) - Fix the native install script exiting immediately without installing anything when run the documented way, `curl -fsSL … | bash`, which also broke automatic background updates for native installs.

- [`d7a5db0`](https://github.com/Pythoughts-labs/pythinker-code/commit/d7a5db02c668ec88f94cb3ccbdb7f314d8a28791) - Report why an automatic update failed instead of failing silently: the installer's error output is now recorded and shown on the next update prompt, native installs on macOS and Linux pin the version the rollout picked, and update messages tell you to open a new terminal to apply the update.

## 0.8.0

### Minor Changes

- [`23e0bc7`](https://github.com/Pythoughts-labs/pythinker-code/commit/23e0bc7ed62e718cee0b709ab0ab483ef6b87708) - Improve performance and fix bugs.

- [`c0f0976`](https://github.com/Pythoughts-labs/pythinker-code/commit/c0f09769e76c92002ca9b9a09d9cb820750f1046) - Remove the Pythinker Datasource plugin from the marketplace; its data gateway backend is not available, so every datasource query failed.

- [`c0f0976`](https://github.com/Pythoughts-labs/pythinker-code/commit/c0f09769e76c92002ca9b9a09d9cb820750f1046) - Enable automatic updates for native installs on Windows: /update now installs the new version in the background instead of printing a manual command, and the installer safely replaces the running executable.

### Patch Changes

- [`c0f0976`](https://github.com/Pythoughts-labs/pythinker-code/commit/c0f09769e76c92002ca9b9a09d9cb820750f1046) - Fix Kimi and Moonshot models rejecting every request with an invalid tool schema error when a tool declares `anyOf` alongside its own type or properties.

## 0.7.0

### Minor Changes

- [#12](https://github.com/Pythoughts-labs/pythinker-code/pull/12) [`02f7f8d`](https://github.com/Pythoughts-labs/pythinker-code/commit/02f7f8d93ff138611298f8d46c5c54e928c7ae59) - Prepare verified Homebrew updates in the background and install them automatically on the next interactive launch.

### Patch Changes

- [#12](https://github.com/Pythoughts-labs/pythinker-code/pull/12) [`02f7f8d`](https://github.com/Pythoughts-labs/pythinker-code/commit/02f7f8d93ff138611298f8d46c5c54e928c7ae59) - Fix context compaction failing with provider "Invalid max_tokens" errors by capping requested completion tokens to the remaining context window and a safe output ceiling instead of the full context window size.

- [#12](https://github.com/Pythoughts-labs/pythinker-code/pull/12) [`02f7f8d`](https://github.com/Pythoughts-labs/pythinker-code/commit/02f7f8d93ff138611298f8d46c5c54e928c7ae59) - Fix Dynamic Workflow progress sticking at 90% during long streaming, show a Finalizing state once all delegated agents finish, and fix member row alignment at narrow widths.

## 0.6.2

### Patch Changes

- [#10](https://github.com/Pythoughts-labs/pythinker-code/pull/10) [`ad2391b`](https://github.com/Pythoughts-labs/pythinker-code/commit/ad2391b5601f173d7eecdaab55f1110f506c1ad1) - Clear the terminal before the install script's animated intro so earlier shell output no longer interleaves with the logo animation.

- [#10](https://github.com/Pythoughts-labs/pythinker-code/pull/10) [`ad2391b`](https://github.com/Pythoughts-labs/pythinker-code/commit/ad2391b5601f173d7eecdaab55f1110f506c1ad1) - Restyle the browser OAuth sign-in confirmation pages for all providers to match the website's light design.

## 0.6.1

### Patch Changes

- [#7](https://github.com/Pythoughts-labs/pythinker-code/pull/7) [`d396320`](https://github.com/Pythoughts-labs/pythinker-code/commit/d396320235e31ce09f04f0da244ec5a694e2bcfe) - Prompt for an API key when connecting a catalog provider whose environment variable is not set, instead of failing with "Environment variable is not set or is empty". Applies to `/login`, `/provider`, and `pythinker provider catalog add`, which now also accepts `--api-key <key>`.

- [#7](https://github.com/Pythoughts-labs/pythinker-code/pull/7) [`d396320`](https://github.com/Pythoughts-labs/pythinker-code/commit/d396320235e31ce09f04f0da244ec5a694e2bcfe) - Explain in `/update` and the startup update notice that Homebrew installs do not auto-update, and point to the native installer for automatic background updates.

- [#7](https://github.com/Pythoughts-labs/pythinker-code/pull/7) [`d396320`](https://github.com/Pythoughts-labs/pythinker-code/commit/d396320235e31ce09f04f0da244ec5a694e2bcfe) - Point the native install scripts at the published release assets.

- [#7](https://github.com/Pythoughts-labs/pythinker-code/pull/7) [`d396320`](https://github.com/Pythoughts-labs/pythinker-code/commit/d396320235e31ce09f04f0da244ec5a694e2bcfe) - Show a clear requirement message with the native-installer alternative when the CLI is launched on Node.js older than 26.4, instead of failing with a cryptic flag error.

- [#8](https://github.com/Pythoughts-labs/pythinker-code/pull/8) [`9b1b195`](https://github.com/Pythoughts-labs/pythinker-code/commit/9b1b19577a5826f33a2bd70116c48bfeb46362ad) - Fix the CLI failing to start on Windows with "process.execve is unavailable" by using the spawn fallback instead of calling execve there.

## 0.6.0

### Minor Changes

- [`d7a2554`](https://github.com/Pythoughts-labs/pythinker-code/commit/d7a25545a6f6fb0c2024a11dcde8012a087c9e44) - Maintenance release with internal improvements and dependency updates.

## 0.5.1

### Patch Changes

- README: point install commands at the canonical code.pythinker.com URLs and correct the npm install path's Node.js floor to 26.4.0 (matching the package engines field).

## 0.5.0

### Minor Changes

- Release pipeline hardening and native-bundle recovery: idempotent npm publish (re-pushes without changesets no longer fail Release), unsigned macOS bundles with a warning when signing secrets are absent, refreshed Nix pnpm-deps hash, monorepo dependency-version sync, strict pre-push quality gates, and Dependabot configuration. Ships the native bundles that 0.4.0's release run failed to produce.

## 0.4.0

### Minor Changes

- Shift-Tab now cycles thinking effort (plan mode moves to /plan), the prompt-box border tints with a per-effort color gradient, upstream fixes ported (goal step-cap continuation, repeat-breaker for validation-rejected tool calls, fail-fast on quota-exhausted 429s), no default provider endpoint (configure your own base URL), restored real Kimi coding-plan model ids in the ACP thinking-toggle list, and dependency security updates.

## 0.3.0

### Minor Changes

- [`fc6a226`](https://github.com/Pythoughts-labs/pythinker-code/commit/fc6a22694298d884070130d5918ce7b14c585fdb) - Add the `/update` slash command (alias `/upgrade`) the welcome banner has been advertising: it checks the CDN for a newer version and installs it in the background, falling back to a copyable command for installs that cannot self-update (e.g. Homebrew). `pythinker doctor` now reports whether auto-update is on, off via `tui.toml [upgrade].auto_install`, or disabled by `PYTHINKER_CODE_NO_AUTO_UPDATE`.

## 0.2.0

### Minor Changes

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add provider-native Fast mode controls for supported OpenAI and Anthropic models.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add validated session and persistent workspace directories with SDK, CLI, and TUI management.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose the precedence-resolved agent profile catalog through the SDK and a searchable TUI command.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add persistent named agent teams with background teammate spawning, shared task scopes, direct and broadcast messaging, assignment delivery, shutdown coordination, and native terminal identities.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add project, user, and namespaced plugin subagent profiles with per-profile turn limits and persistent memory, context-fork workers, per-agent model and working-directory overrides, and Git worktree isolation with native terminal status.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add Anthropic Claude Code marketplace browsing and installation with searchable source selection and install-definition support.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Preserve full truncated Bash output on disk, interpret informational exit codes, and expand destructive-command warnings in the terminal approval flow.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add clearer TUI startup status, effort heat, Dynamic Workflow progress colors, and a brighter dark-theme primary.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add catalog-backed provider connections with interactive or environment-referenced credentials, live model discovery, provider-aware model selection, and model-specific thinking controls.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add an agent-callable Config tool for approved, validated reads and writes of supported Pythinker settings.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add configurable Global and Chat TUI keybindings with unbinding, two-key chords, reserved shortcuts, dynamic help labels, template creation, and editor-backed reload.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose files loaded by Read through the SDK and a `/files` TUI command.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose the model-visible context breakdown through the SDK and a `/context` TUI report.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Show Dynamic Workflow in a coral-framed mission-control panel with live per-agent progress, and let workflow agents run without an automatic timeout.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add persisted file checkpoints with preview and recovery-backed code or conversation rewind through the SDK, CLI, and TUI.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add fail-closed Read/Edit/Write state tracking, quote-preserving edits, automatic parent creation, and cell-aware Jupyter notebook editing with terminal summaries.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add unchanged-range deduplication and structured Jupyter notebook reads with cell, text-output, and image-output support.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Rework the TUI into a fixed full-height layout: the input box and status bar stay pinned to the bottom, the mouse wheel scrolls the conversation, drag-selecting text copies it to the clipboard, and `layout = "inline"` in tui.toml restores the legacy inline behavior.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add configurable context-aware keybindings across dialogs, plugins, rewind,
  message actions, footer controls, and both terminal renderers.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add experimental plugin-configured language-server support with lazy stdio servers and agent-callable navigation, symbol, hover, reference, implementation, and call-hierarchy operations.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add MCP resource discovery and reading with terminal-native summaries.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add live instruction refresh and a `/memory` command for user and project memory files.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add discoverable built-in, user, project, and plugin output styles with config-backed prompt injection and TUI selection.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add experimental native PowerShell execution on Windows with non-interactive invocation, streamed foreground and background output, timeout handling, exact-command approval, and terminal language metadata.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add responsive option previews, per-question notes, answer annotations, automatic Other choices, and source telemetry tags to structured questions.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Complete Glob and Grep parity with absolute glob patterns, sensitive-name filtering, context aliases, and multiple glob filters.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add `/cost` to show accumulated session spend and current model token rates, with pricing data available through SDK session status.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose session metadata through the SDK and add searchable session tags with `/tag`.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add explicitly requested session worktree entry and exit with named resume, cwd and hook rebinding, safe keep behavior, and fail-closed removal confirmation.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add JSON Schema validated structured output to prompt mode.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add persistent project-task creation, lookup, dependency-aware listing, and updates while retaining explicit background-task listing.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add per-model thinking effort levels: pick the level in the model selector or with the new `/effort` command, cycle it with Ctrl-T, and see the current level in the footer and on the input box border.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Show estimated token throughput while output streams in the TUI footer, then replace it with the provider-reported completed rate.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add a TUI copy command for recent assistant responses and fenced code blocks with clipboard and file fallbacks.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Build the OpenTUI dialog slice with native searchable-dialog interactions.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose configuration and keybinding diagnostics through the TUI doctor command.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add `/colors` and polish terminal progress, context, question, and Markdown activity displays while preserving reasoning-summary boundaries.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add native TUI management for persisted allow, ask, and deny permission rules.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add TUI commands for listing discovered skills and configured hooks.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expand the TUI colour palette from 18 to 50 semantic tokens — shimmer variants, eight per-subagent identity colours, dimmed diff shades, a rainbow set, mode-identity badges, background surfaces, and progress-bar fill — and add a curried theme-aware `colorize` helper that accepts either a palette token or a raw hex.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Wire the vim core into the composer behind an opt-in `vimMode` option. A narrow, version-pinned bridge is the only seam to pi-tui's private editor state; terminal escape sequences and bracketed pastes are classified before vim sees them, so paste, arrows, and Kitty-protocol keys keep working in every mode.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add the `vim_mode` experimental flag, off by default, so modal editing in the composer can be toggled through `/vim` or `/experiments`, `PYTHINKER_CODE_EXPERIMENTAL_VIM_MODE`, or config. The editor picks the flag up when the snapshot lands and follows runtime configuration changes.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add the vim-mode state machine for the composer: NORMAL/INSERT transitions, counts, and the full movement set (character, line, word, line-anchored, document, and line-local find with repeat). Pure and renderer-agnostic — editing operators, text objects, and visual mode follow, as does the editor wiring.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add vim editing operators to the composer state machine: `d`/`c`/`y` over any motion, doubled linewise forms, the single-key shortcuts (`x`, `X`, `s`, `S`, `D`, `C`, `Y`), text objects (`iw`/`aw`, quotes, nested brackets), and an unnamed register with charwise and linewise paste.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Complete the vim core for the composer: charwise and linewise visual mode with selection operators, and dot-repeat (`.`) driven by a structured repeat spec rather than replayed keystrokes.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add a read-only verification agent and request independent checks when multi-step task lists close without verification.
  Accept TodoWrite-compatible checklist items and show their active labels while tasks are in progress.
  Cache successful local URL fetches for 15 minutes with a 50 MiB bound.
  Preserve binary URL responses and save them through Kaos with MIME-derived filenames.
  Propagate WebSearch cancellation, report live search progress, and remind responses to cite relevant results.
  Retry transient LSP content-modified responses with bounded exponential backoff.
  Filter gitignored files from location-based LSP results.
  Restart configured language servers when a session enters or exits a worktree.
  Surface bounded, deduplicated passive language-server diagnostics before the next model step.
  Lighten the dark-theme periwinkle, clip structural tool rows instead of wrapping them, and copy mouse selections through both terminal and system clipboards.
  Add policy-controlled HTTP hooks with secret-safe headers, cancellation, SSRF protection, and structured allow or block responses.
  Support one-shot command and HTTP hooks through `once = true`.
  Run command and HTTP hooks in the background through `async = true`.
  Support `async_rewake` command hooks that run in the background and steer exit-code-2 blocking errors back into the main agent.

  Add prompt and agent hook executors with argument substitution, structured allow/block results, model overrides, bounded timeouts, current-conversation context for prompt checks, and the existing read-only verification profile for agent checks.

  Support permission-rule `if` filters for pre-tool, post-tool, post-tool-failure, and permission-request hooks using each tool's existing rule matcher.
  Emit `PermissionDenied` hooks with the rejected tool call and reason for policy and user approval denials.
  Honor structured `PermissionDenied` retry guidance for policy denials without weakening explicit user rejections.
  Run source-compatible `Setup(init)` hooks before `/init` generates project instructions and through the hidden `--init` startup flag.
  Run `Setup(init)` and `SessionStart(startup)` through hidden `--init-only`, then close before mounting the TUI.
  Run source-compatible `Setup(maintenance)` hooks through the hidden `--maintenance` startup flag before fresh or resumed session lifecycle hooks.

  Allow command hooks to select deterministic non-interactive PowerShell execution while preserving Bash as the default.
  Prefer PowerShell 7 for native PowerShell tool calls and fall back to Windows PowerShell when it is unavailable.
  Show configured hook status messages in a transient TUI spinner while command, HTTP, prompt, or agent hooks run.
  Run blocking `TaskCreated` and `TaskCompleted` hooks around project task mutations, rolling back rejected creation and preventing rejected completion.
  Report user and project AGENTS files loaded into the main context through source-compatible `InstructionsLoaded` hooks.
  Report worktree entry and exit through source-compatible `CwdChanged` hooks.
  Watch configured workspace files and emit source-compatible `FileChanged` hooks for add, change, and unlink events.
  Accept absolute dynamic watch paths from structured hook output and replace the live `FileChanged` watcher set.
  Reroot relative `FileChanged` hook paths when a worktree changes the session working directory.
  Run matching `ConfigChange(user_settings)` hooks before in-app configuration writes and leave the file unchanged when a hook blocks.
  Run `SessionStart` hooks with the `compact` source after successful compaction and before `PostCompact`.
  Show command and HTTP hook targets plus `once` and `async` modes in `/hooks` without exposing headers.
  Render compaction progress as elapsed seconds with a matching 40-cell percentage bar.
  Add an experimental coordinator main-agent profile backed by the existing worker catalog and durable session profiles.
  Continue explicit experimental token-target prompts until they approach the target or hit diminishing returns.
  Carry the authorized-security and destructive-abuse boundary in the default agent prompt.
  Keep default responses, progress updates, reasoning, and generated AGENTS instructions in English unless the user explicitly requests another response language.
  Honor output styles that disable the bundled coding instructions.
  Load bounded project memory into the main agent when experimental agent memory is enabled.
  Classify persistent memories by user, feedback, project, or reference type and verify recalled source claims against live project state.
  Warn when agent-memory topic files are older than one day and require live verification of recalled code claims.
  Reload TUI keybindings automatically when `keybindings.json` changes.
  Support `command:<name>` keybindings and warn about duplicate entries, inactive contexts, and shortcuts that may be intercepted by the terminal or macOS while leaving soft-reserved bindings available.
  Detect normalized shortcut conflicts across separate keybinding blocks and aliases.
  Support source-compatible redraw, history search/navigation, model picker, cancel, and submit keybinding actions through native editor behavior.
  Search the current project's persisted prompt history with Ctrl+R and restore the selected input.
  Include a bounded Git repository snapshot with sanitized remote metadata, branches, configured user, dirty files, and recent commits in the main agent's startup context.
  Honor skill `user-invocable` and `argument-hint` frontmatter in TUI command discovery, keep model access independent, and expand source-compatible skill directory and session placeholders.
  Activate skills with `paths` frontmatter after successful matching Read, Write, or Edit calls.
  Discover Git-ignore-safe nested project skill directories after successful file-tool access.
  Run `context: fork` skills through foreground subagents for model and user invocations, honoring profile, model, effort, and scoped allowed-tool metadata.
  Scope inline skill model, effort, and allowed-tool overrides to the active turn and restore the prior runtime afterward.
  Validate and register session-scoped hooks from invoked skill frontmatter.
  Preload profile-declared skills into a subagent's first prompt.
  Validate profile frontmatter hooks, scope them to the child agent, and remove them after completion.
  Run blocking `TeammateIdle` hooks before teammates go idle and continue the child when a hook requests more work.
  Reload AGENTS instructions after successful compaction and emit `InstructionsLoaded(compact)` before post-compaction hooks.
  Load descendant AGENTS instructions after successful file access, deduplicate them until compaction, and emit `InstructionsLoaded(nested_traversal)` with the triggering file.
  Use configured `WorktreeCreate` and `WorktreeRemove` hooks as a VCS-neutral isolation backend for session and subagent worktrees.
  Resume legacy task-tool calls through canonical TaskOutput and TaskStop aliases, including KillShell shell_id inputs.
  Activate pending plugin changes through the source-compatible `/reload-plugins` command.
  Resolve the source `/reset`, `/continue`, `/bashes`, and `/bug` aliases to their native TUI commands.
  Capture private JavaScript heap snapshots and memory diagnostics through the hidden `/heapdump` command.
  Expose the canonical Pythinker changelog through `/release-notes`.
  Resolve the source `/plugin` command to Pythinker's native plugin manager.
  Expand `/review` into a focused pull request review workflow that uses the existing agent and permission system.
  Expand `/commit` and `/commit-push-pr` into guarded Git publishing workflows without bypassing hooks or attribution rules.
  Manage persisted telemetry privacy through `/privacy-settings`, with immediate runtime opt-out.
  Report native Shift-Enter and universal Ctrl-J multiline input support through `/terminal-setup`.
  Report the running version, install source, package root, executable path, duplicate PATH installations, and resolved ripgrep source through `/doctor`.
  Report Pythinker's validated cached CDN rollout version through `/doctor`.
  Include config warnings, agent-profile parse failures, and plugin diagnostics in the TUI doctor report.
  Warn through `/doctor` when custom-agent descriptions or MCP tool schemas consume excessive context.
  Enable debug-level diagnostics and analyze a bounded current-session log tail through `/debug`.
  Create Pythinker-native functional verifier skills through `/init-verifiers` and let the read-only verification agent invoke them without gaining mutation tools.
  Expand `/security-review` and `/pr-comments` into focused GitHub review workflows through the existing agent and permission system.
  Schedule recurring prompts through the built-in `/loop` workflow and execute the requested prompt immediately once.
  Expose active built-in tools over stdio through `pythinker mcp serve`, preserving schema validation, permissions, and multimodal results.
  Handle MCP form elicitation through the existing question UI with typed JSON Schema validation and paged fields.
  Run source-compatible `Elicitation` and `ElicitationResult` hooks around MCP forms, including validated hook-supplied responses.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add cancellable URL fetching with per-host approval and safe redirect handoff, plus allowed and blocked domain filters for web search.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Expose bounded working-tree diffs through the SDK and a native `/diff` browser.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Add a configurable `[status_line]` TUI section to toggle footer status items, and show the YOLO indicator on a dedicated row beneath the model.

### Patch Changes

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Align Anthropic-compatible thinking profiles, output limits, and incomplete stream handling with model capabilities.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Pulse the Bash activity marker while a command is running and keep the completed marker green.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Accept `/branch` and `/rewind` as compatibility aliases for `/fork` and `/undo`.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Allow provider catalog refresh for providers that register an API key directly instead of an environment variable.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Update OpenAI Codex OAuth for the new model catalog: bump the models client_version gate to 0.145.0 so the gpt-5.6 family appears, carry each model's supported reasoning efforts into config, send real max effort on the wire (ultra maps in as max), clamp requests to what each model supports, and default Codex sign-in to the top supported effort.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Align context usage displays with 1024-based units and ceiled percentages.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Prevent repeated session debug exports from overwriting earlier archives by including a timestamp in the default filename.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Default agent reasoning and responses to English unless the user explicitly requests another language.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Increase the default per-step LLM retry budget from 3 to 10 attempts.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Allow DynamicWorkflow items to be complete prompts when no template is supplied.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Show DynamicWorkflow request failures once instead of repeating the reason for every member.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Pin @agentclientprotocol/sdk to ^0.23.0 to restore the unstable session-model API the ACP adapter implements, and fix the adapter's typecheck.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Rename the stale afk reference to auto in the built-in MCP configuration guidance.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Prevent agent idle cleanup failures from surfacing as unhandled rejections.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Translate binary download failures through the standard fetch error path.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix Unicode-safe Vim editing, application shortcuts, selector state, key chords, mouse-selection auto-scrolling, and active-tab contrast.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Preserve graceful shutdown and exit codes under repeated signals or closed output streams, persist provider removals and cleared defaults, reject unsafe marketplace refs, and recover safely from stalled marketplace loads and interrupted update installs.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix ctrl+b / ctrl+f paging in the approval preview and task output viewer under the Kitty keyboard protocol. Both shortcuts compared raw C0 bytes, so they did nothing in terminals that send CSI-u — including VSCode's integrated terminal — while the page-up/page-down checks beside them worked.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Keep Dynamic Workflow results bounded and correctly decoded while preventing undone workflows from receiving late events.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Preserve MCP prompt client binding during skill activation.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Honor an explicit thinking off setting on OpenAI-compatible providers.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Correct the YOLO and Auto permission mode descriptions in CLI help output and ACP session mode selectors.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Correct the YOLO and Auto permission mode descriptions in the web slash command list and mobile permission sheet.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Clarify that YOLO auto-approves tool actions while Auto runs fully autonomously without asking questions.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix TypeScript errors in the TUI welcome/logo components and their tests (index-signature env access, possibly-undefined logo rows).

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Prevent silent exits from clipboard image failures and report unhandled promise rejections in crash telemetry.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Preserve extended Unicode characters when normalizing replacement quotes.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix sessions getting stuck after a provider records an assistant message with no sendable content.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix duplicate workspace groups on Windows when the same folder is opened with different path spellings, keeping all of the folder's sessions in one merged group.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Correct the YOLO mode notice shown when replaying a session.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Include the underlying network cause in OAuth connection error messages instead of only reporting a generic fetch failure.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Resolve every bare `solid-js` import to OpenTUI's client runtime so Solid signal updates reach the terminal buffer.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Stop showing a status message after successful automatic keybinding reloads.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Record and close tool calls that never ran after an interrupted model response.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Replay empty thinking content verbatim on preserved-thinking endpoints.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Scope inferred Anthropic thinking profiles to non-managed Anthropic-compatible providers.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix the built-in URL fetch tool's network safeguards so crafted domains and redirect chains cannot reach loopback or internal network services.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Render the slash command menu below the composer and give the selected command a themed pointer and muted description lines.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Make MCP startup status lines transient in the TUI: connected/disabled rows show a success mark and disappear after 3 seconds instead of permanently cluttering the transcript, while failed and needs-auth rows stay visible. The welcome-header aggregate remains the durable indicator.

- [`357c850`](https://github.com/Pythoughts-labs/pythinker-code/commit/357c850cdaf1c8be669566ff7a88af895bcf5c4a) - Fix display-width measurement on the OpenTUI render path: strip ANSI escapes before measuring, segment by grapheme cluster so ZWJ emoji and skin-tone modifiers count once, and expand tabs to match the legacy renderer. Footer, composer, and dialog-list text no longer mis-truncate when coloured or containing emoji.

## 0.17.1

### Patch Changes

- [#861](https://github.com/PythoughtsAI/pythinker-code/pull/861) [`bd09795`](https://github.com/PythoughtsAI/pythinker-code/commit/bd0979578bcad5fe3bf989e022b7823824f3f25c) - Prevent the web login dialog from closing when clicking the backdrop.

- [#860](https://github.com/PythoughtsAI/pythinker-code/pull/860) [`0e2877b`](https://github.com/PythoughtsAI/pythinker-code/commit/0e2877bee347466ed6cc8afda9f9faf338069012) - Stop the background local server from locking the directory it was started in.

- [#860](https://github.com/PythoughtsAI/pythinker-code/pull/860) [`0e2877b`](https://github.com/PythoughtsAI/pythinker-code/commit/0e2877bee347466ed6cc8afda9f9faf338069012) - Fix the local server failing to start in the background on the native binary.

- [#861](https://github.com/PythoughtsAI/pythinker-code/pull/861) [`bd09795`](https://github.com/PythoughtsAI/pythinker-code/commit/bd0979578bcad5fe3bf989e022b7823824f3f25c) - Group the default model dropdown in web settings by provider.

## 0.17.0

### Minor Changes

- [#625](https://github.com/PythoughtsAI/pythinker-code/pull/625) [`9a8fea5`](https://github.com/PythoughtsAI/pythinker-code/commit/9a8fea5c85177cd887896108c05ba9e174f28250) - Add the server-hosted web UI and the CLI commands that power it:

  - `pythinker server` to start, stop, and manage the local server.
  - `pythinker web` to open the server-hosted web UI in a browser.
  - Server REST and WebSocket APIs for the web client.
  - Web chat layout, session list, auto-scroll, and related behaviors.

### Patch Changes

- [#838](https://github.com/PythoughtsAI/pythinker-code/pull/838) [`843a731`](https://github.com/PythoughtsAI/pythinker-code/commit/843a731097fc18b2e41ab0405b5fbcb6149ba55c) - Show the underlying connection error when OAuth token refresh fails after internal retries, instead of prompting for login. Token refresh failures are no longer re-retried at the agent loop level.

- [#849](https://github.com/PythoughtsAI/pythinker-code/pull/849) [`254f946`](https://github.com/PythoughtsAI/pythinker-code/commit/254f946a506b01df7a559ed63bd8d705e9fa7496) - Skip debug TPS when the output stream is too short to measure reliably.

- [#833](https://github.com/PythoughtsAI/pythinker-code/pull/833) [`a71b2e3`](https://github.com/PythoughtsAI/pythinker-code/commit/a71b2e3123ff8454f725b3d24e8c985608c5c4f9) - Restore the turn counter from persisted loop events on resume so post-resume turns no longer reuse turn ids that already appear in history.

- [#853](https://github.com/PythoughtsAI/pythinker-code/pull/853) [`05fe759`](https://github.com/PythoughtsAI/pythinker-code/commit/05fe7595ab9bac8230fd9f2fe7bdbaaa157ddc9b) - Fix the web login page and no-workspace conversation startup flow.

## 0.16.0

### Minor Changes

- [#788](https://github.com/PythoughtsAI/pythinker-code/pull/788) [`efdf8a1`](https://github.com/PythoughtsAI/pythinker-code/commit/efdf8a1b2d4e906fbb35620083c3e7b490e0e88a) - Add a built-in `pythinker dashboard` command that launches the session dashboard in your browser, pointed at your local sessions. Supports `--port`/`--host`, `--no-open`, and `pythinker dashboard <sessionId>` deep-links.

### Patch Changes

- [#790](https://github.com/PythoughtsAI/pythinker-code/pull/790) [`d0d5821`](https://github.com/PythoughtsAI/pythinker-code/commit/d0d58219007cd9d7355f1ea8900e9777b66abda2) - Stop Anthropic-compatible providers from reading ambient Anthropic shell credentials and custom headers.

- [#809](https://github.com/PythoughtsAI/pythinker-code/pull/809) [`6f442bd`](https://github.com/PythoughtsAI/pythinker-code/commit/6f442bd8cde29e21526fa36c9836e2d4c282b4bf) - Add configurable banner display frequencies with local display state.

- [#807](https://github.com/PythoughtsAI/pythinker-code/pull/807) [`b45672c`](https://github.com/PythoughtsAI/pythinker-code/commit/b45672cdaac9959024c3ae36bf35b16a423aa1dc) - Close wrapped output streams when buffered readers are destroyed.

- [#813](https://github.com/PythoughtsAI/pythinker-code/pull/813) [`7b5b818`](https://github.com/PythoughtsAI/pythinker-code/commit/7b5b8188157ec902e5cd4e73545bc5ca6c52bb76) - Fix repeated compaction handling when context remains over the blocking threshold.

- [#801](https://github.com/PythoughtsAI/pythinker-code/pull/801) [`ff332be`](https://github.com/PythoughtsAI/pythinker-code/commit/ff332be6d364ce3d5974133deb7c76220684181a) - Polish queue pane styling

- [#802](https://github.com/PythoughtsAI/pythinker-code/pull/802) [`aa1896c`](https://github.com/PythoughtsAI/pythinker-code/commit/aa1896ca749e41a67d7c4b655dcc8be830cbec82) - Reduce the maximum height of the /btw side panel from half to one-third of the terminal.

- [#805](https://github.com/PythoughtsAI/pythinker-code/pull/805) [`3e6196e`](https://github.com/PythoughtsAI/pythinker-code/commit/3e6196e6b227c66860651f4335e06973865b2714) - Project session replay ranges over rendered replay records instead of raw persisted records.

- [#804](https://github.com/PythoughtsAI/pythinker-code/pull/804) [`299b9fc`](https://github.com/PythoughtsAI/pythinker-code/commit/299b9fcad4c9c4b755fae4dfae01a1dbf60aec3c) - Prevent session shutdown from resuming the agent when stopping background tasks.

- [#823](https://github.com/PythoughtsAI/pythinker-code/pull/823) [`90fc04b`](https://github.com/PythoughtsAI/pythinker-code/commit/90fc04b7072ec20055022c50583d35286ca715a6) - Remove redundant LLM request logging context plumbing.

## 0.15.0

### Minor Changes

- [#779](https://github.com/PythoughtsAI/pythinker-code/pull/779) [`2746c71`](https://github.com/PythoughtsAI/pythinker-code/commit/2746c71c47058d9a3bb73e27a07ebfcf44bf4119) - Add an all-sessions picker view with name search, paginated browsing, and clipboard-ready resume commands for sessions in other working directories.

- [#744](https://github.com/PythoughtsAI/pythinker-code/pull/744) [`18f299f`](https://github.com/PythoughtsAI/pythinker-code/commit/18f299fd0b266545a1f7cebae9f58b83b9d9776e) - Add support for legacy SSE MCP servers alongside stdio and streamable HTTP transports.

### Patch Changes

- [#777](https://github.com/PythoughtsAI/pythinker-code/pull/777) [`4516f62`](https://github.com/PythoughtsAI/pythinker-code/commit/4516f62f6a7e4dd7675a3aec16b2a26c5e310d83) - Clarify AGENTS.md prompt guidance and mark truncated instruction files.

- [#780](https://github.com/PythoughtsAI/pythinker-code/pull/780) [`8a92db6`](https://github.com/PythoughtsAI/pythinker-code/commit/8a92db6a0c110a21c6e6e86622f498e836178e5f) - Prompt the CLI to show one brief same-language status sentence before non-trivial tool calls.

- [#786](https://github.com/PythoughtsAI/pythinker-code/pull/786) [`e10b25f`](https://github.com/PythoughtsAI/pythinker-code/commit/e10b25f9be18ca64aada0d0a3cab0e02fdbd46df) - Stop writing resume version markers into persisted agent metadata.

- [#768](https://github.com/PythoughtsAI/pythinker-code/pull/768) [`c6a9967`](https://github.com/PythoughtsAI/pythinker-code/commit/c6a996756cd8f1fb317b6eee6f4e668eebc7dc14) - Recover resumed sessions when an interrupted tool call result was not recorded.

- [#775](https://github.com/PythoughtsAI/pythinker-code/pull/775) [`3fa1b8e`](https://github.com/PythoughtsAI/pythinker-code/commit/3fa1b8ea7deb558b88073b5f7b02857e52c3f60c) - Optimize the npm packaging system.

- [#343](https://github.com/PythoughtsAI/pythinker-code/pull/343) [`73be7ba`](https://github.com/PythoughtsAI/pythinker-code/commit/73be7ba17d41df7999d4c1fba410994e7024eb7b) - Repair mismatched JSON Schema types emitted by Xcode 26.5 MCP server for Pythoughts compatibility.

- [#777](https://github.com/PythoughtsAI/pythinker-code/pull/777) [`4516f62`](https://github.com/PythoughtsAI/pythinker-code/commit/4516f62f6a7e4dd7675a3aec16b2a26c5e310d83) - Collapse hidden directories in the workspace prompt and explain how to inspect them.

- [#766](https://github.com/PythoughtsAI/pythinker-code/pull/766) [`9cef896`](https://github.com/PythoughtsAI/pythinker-code/commit/9cef89656311974a57e6675f474ea6c2adb1d8e9) - Clarify that compaction summaries must be emitted in the final answer.

- [#765](https://github.com/PythoughtsAI/pythinker-code/pull/765) [`046856b`](https://github.com/PythoughtsAI/pythinker-code/commit/046856b740afb604132e914f1fc489de72394036) - Read media files using header-detected types before falling back to media extensions.

- [#779](https://github.com/PythoughtsAI/pythinker-code/pull/779) [`2746c71`](https://github.com/PythoughtsAI/pythinker-code/commit/2746c71c47058d9a3bb73e27a07ebfcf44bf4119) - Show the all-sessions toggle hint when the current working directory has no sessions.

- [#785](https://github.com/PythoughtsAI/pythinker-code/pull/785) [`4578f05`](https://github.com/PythoughtsAI/pythinker-code/commit/4578f05f44101f24d45c6452e2a6993cbb52e331) - Include the skill's directory on the loaded-skill context block so the agent can locate a skill's bundled resources (scripts, templates) after it is invoked.

- [#784](https://github.com/PythoughtsAI/pythinker-code/pull/784) [`a562ef5`](https://github.com/PythoughtsAI/pythinker-code/commit/a562ef54e537a36211c48f0fe19e9252e83397a0) - Decouple agent skill access from session-specific registry implementations.

- [#772](https://github.com/PythoughtsAI/pythinker-code/pull/772) [`d47e699`](https://github.com/PythoughtsAI/pythinker-code/commit/d47e699015f02f4f76723aa8fb17d51a74aa74ff) - Do not carry obsolete legacy loop, background, plan, yolo, or unknown experimental flags into migrated config files.

- [#783](https://github.com/PythoughtsAI/pythinker-code/pull/783) [`e2a407c`](https://github.com/PythoughtsAI/pythinker-code/commit/e2a407ce31685220b2f891a7f6d8b89c62418c98) - Keep TUI components within narrow terminal widths by wrapping, compacting, or truncating lines that could exceed the render width.

- [#776](https://github.com/PythoughtsAI/pythinker-code/pull/776) [`ecd7a0a`](https://github.com/PythoughtsAI/pythinker-code/commit/ecd7a0afb646d14a14c780a4088fd8a59da134ad) - Resolve model capabilities through a static lookup instead of instantiating a temporary provider.

- [#767](https://github.com/PythoughtsAI/pythinker-code/pull/767) [`a355f2a`](https://github.com/PythoughtsAI/pythinker-code/commit/a355f2af2fd68ad9e2bdc72ce854cd18c8242ce8) - Prioritize clearing draft editor text before Ctrl-C cancels an active stream.

- [#787](https://github.com/PythoughtsAI/pythinker-code/pull/787) [`1eb363f`](https://github.com/PythoughtsAI/pythinker-code/commit/1eb363f655aa44abc1e5c3af89016f00764ecc95) - Extend the same-language rule to the model's reasoning, so thinking follows the user's language while keeping code and technical terms in their original form.

## 0.14.3

### Patch Changes

- [#713](https://github.com/PythoughtsAI/pythinker-code/pull/713) [`f874251`](https://github.com/PythoughtsAI/pythinker-code/commit/f874251288927243a9b9d4bfd546e8c17754d566) - Refresh provider model metadata before opening the model picker.

## 0.14.2

### Patch Changes

- [#683](https://github.com/PythoughtsAI/pythinker-code/pull/683) [`ad239cb`](https://github.com/PythoughtsAI/pythinker-code/commit/ad239cb1c08266a442c9ca0382fefed87bcb1fd4) - Allow `--auto`, `--yolo`, and `--plan` to be combined with `--session` or `--continue` by applying the requested mode to the resumed session.

- [#690](https://github.com/PythoughtsAI/pythinker-code/pull/690) [`7f0dde2`](https://github.com/PythoughtsAI/pythinker-code/commit/7f0dde2ece3f9a004e934d69258dfd47c954043c) - Fix endless desktop notifications in iTerm2 by only sending terminal progress sequences to terminals that support them.

- [#651](https://github.com/PythoughtsAI/pythinker-code/pull/651) [`c39c625`](https://github.com/PythoughtsAI/pythinker-code/commit/c39c62590db708fc81bd8627ea661c38f3fff9af) - Qualify sub-skill names with their parent prefix and expose sub-skills as dotted slash commands in the TUI.

- [#617](https://github.com/PythoughtsAI/pythinker-code/pull/617) [`911e7c3`](https://github.com/PythoughtsAI/pythinker-code/commit/911e7c3fcfc8a005b1b8d90388260d1a4032f76f) - Show completed and cancelled compaction records correctly when resuming a session.

- [#676](https://github.com/PythoughtsAI/pythinker-code/pull/676) [`dcf3075`](https://github.com/PythoughtsAI/pythinker-code/commit/dcf30754d09c7560101bc410387792194c3fe2b4) - Stream foreground Bash stdout and stderr while commands are still running.

- [#692](https://github.com/PythoughtsAI/pythinker-code/pull/692) [`7ca9bdf`](https://github.com/PythoughtsAI/pythinker-code/commit/7ca9bdfed516d148b063229a9686a28f9e29aaef) - Skip re-entering plan mode when resuming a session that is already in plan mode (previously failed with "Already in plan mode"), and stop re-applying `--auto`/`--yolo`/`--plan` startup flags when switching sessions through the `/sessions` picker.

- [#675](https://github.com/PythoughtsAI/pythinker-code/pull/675) [`d1ba145`](https://github.com/PythoughtsAI/pythinker-code/commit/d1ba14562bafdb6b93c3eec1b5c453186507ed56) - Sync custom registry provider additions, removals, and rotated registry keys during startup refresh.

- [#689](https://github.com/PythoughtsAI/pythinker-code/pull/689) [`8d251f8`](https://github.com/PythoughtsAI/pythinker-code/commit/8d251f8ab44ead65f6c1bb264980ee7d075142ad) - Drop invalid config.toml sections with a warning instead of failing to start.

## 0.14.1

### Patch Changes

- [#643](https://github.com/PythoughtsAI/pythinker-code/pull/643) [`4e5043b`](https://github.com/PythoughtsAI/pythinker-code/commit/4e5043b03b2fb03374550dc65d04871bc83e932a) - Require AgentSwarm tool calls to run alone in a model response.

- [#631](https://github.com/PythoughtsAI/pythinker-code/pull/631) [`2961425`](https://github.com/PythoughtsAI/pythinker-code/commit/296142544ec64e93c9083a51d3a53a83496d10cb) - Wrap long command and skill descriptions in the autocomplete menu onto a second line instead of cutting them off.

- [#661](https://github.com/PythoughtsAI/pythinker-code/pull/661) [`0927f79`](https://github.com/PythoughtsAI/pythinker-code/commit/0927f79883e036d0127d4384f60f8e486afb3b8c) - Cancel active turns during session shutdown so foreground shell commands do not outlive prompt-mode exits.

- [#604](https://github.com/PythoughtsAI/pythinker-code/pull/604) [`7ec738c`](https://github.com/PythoughtsAI/pythinker-code/commit/7ec738c4a1de41b3a042cfb48700dfaf51e9de94) - Fix premature stream close errors when shell processes time out or are killed.

- [#632](https://github.com/PythoughtsAI/pythinker-code/pull/632) [`d8cdebf`](https://github.com/PythoughtsAI/pythinker-code/commit/d8cdebf3c03efa3a3dfa4f1deb3186a8f8f7f5ef) - Degrade unsupported audio/video to placeholder text and reattach tool result media instead of silently dropping them.

- [#628](https://github.com/PythoughtsAI/pythinker-code/pull/628) [`0ee9106`](https://github.com/PythoughtsAI/pythinker-code/commit/0ee91066eaa8ec794c8337faefc14d1b1200ce82) - Fix ACP file reads and edits for Windows workspaces opened through IDE clients.

- [#658](https://github.com/PythoughtsAI/pythinker-code/pull/658) [`0381329`](https://github.com/PythoughtsAI/pythinker-code/commit/0381329570d3dca9fd861761c843968cc1c5e927) - Send OpenAI Responses system prompts as request instructions.

- [#654](https://github.com/PythoughtsAI/pythinker-code/pull/654) [`ff80327`](https://github.com/PythoughtsAI/pythinker-code/commit/ff803273440f3a2ff53d2c529c6fc892fde1d93f) - Propagate configured execution environment overrides across spawned processes.

- [#644](https://github.com/PythoughtsAI/pythinker-code/pull/644) [`a58b5b2`](https://github.com/PythoughtsAI/pythinker-code/commit/a58b5b20bb42228c72277daba9fa07bb1cd539a6) - Polish builtin skills.

- [#649](https://github.com/PythoughtsAI/pythinker-code/pull/649) [`a2c5e1b`](https://github.com/PythoughtsAI/pythinker-code/commit/a2c5e1be25484f7c52f729e333196c485f83b84c) - Add runtime support for dynamic MCP server updates, reference skills, replay timestamps, and Node file uploads.

- [#631](https://github.com/PythoughtsAI/pythinker-code/pull/631) [`2961425`](https://github.com/PythoughtsAI/pythinker-code/commit/296142544ec64e93c9083a51d3a53a83496d10cb) - Find slash commands by their aliases in autocomplete — typing `/clear` now suggests `new (clear)`.

- [#648](https://github.com/PythoughtsAI/pythinker-code/pull/648) [`54302ad`](https://github.com/PythoughtsAI/pythinker-code/commit/54302ad612294056a47ada74b76737f2284861b5) - Prevent overlapping interactive agent requests from using the wrong active agent.

- [#641](https://github.com/PythoughtsAI/pythinker-code/pull/641) [`30459af`](https://github.com/PythoughtsAI/pythinker-code/commit/30459af6abc8308e7f13822d9dbef3a5be80dd4a) - Stop background tasks by default when sessions close.

- [#645](https://github.com/PythoughtsAI/pythinker-code/pull/645) [`1b58aa8`](https://github.com/PythoughtsAI/pythinker-code/commit/1b58aa8cdf675e6f4c02cd083feb55debbe9b3f1) - Add a YOLO choice when starting swarm tasks from Manual mode.

- [#655](https://github.com/PythoughtsAI/pythinker-code/pull/655) [`1e2e679`](https://github.com/PythoughtsAI/pythinker-code/commit/1e2e679693af2fc97826078aa671555a3a900349) - Display a tips banner below the welcome panel on startup.

## 0.14.0

### Minor Changes

- [#607](https://github.com/PythoughtsAI/pythinker-code/pull/607) [`b253a82`](https://github.com/PythoughtsAI/pythinker-code/commit/b253a82a7a5f7d91883dc77a30b8b38f8b6e1470) - Add an `Interrupt` hook event that fires when the user interrupts a turn (e.g. pressing Esc), letting hooks observe the turn stopping instead of getting stuck on a working state.

### Patch Changes

- [#626](https://github.com/PythoughtsAI/pythinker-code/pull/626) [`856ec00`](https://github.com/PythoughtsAI/pythinker-code/commit/856ec002906f4964086915ceb9aa616b89ab6594) - Preserve image outputs from tools when using OpenAI-compatible chat completions.

## 0.13.1

### Patch Changes

- [#610](https://github.com/PythoughtsAI/pythinker-code/pull/610) [`b747c6a`](https://github.com/PythoughtsAI/pythinker-code/commit/b747c6a9501e208250d09cf9a2810c885c6ce91b) - Add Claude Fable 5 support to the Anthropic provider.

- [#615](https://github.com/PythoughtsAI/pythinker-code/pull/615) [`494554e`](https://github.com/PythoughtsAI/pythinker-code/commit/494554eac5d34d6a3c5c36b6fb2b2e5397b07f0c) - Add an interactive undo selector and clearer undo-limit messages.

- [#598](https://github.com/PythoughtsAI/pythinker-code/pull/598) [`32d7080`](https://github.com/PythoughtsAI/pythinker-code/commit/32d708083730c14090f855b1fcb650e2bc713797) - Clarify active skill prompts so loaded skills are no longer represented as system reminders.

- [#595](https://github.com/PythoughtsAI/pythinker-code/pull/595) [`1580f35`](https://github.com/PythoughtsAI/pythinker-code/commit/1580f35136eed02331dcff6c8482247d5cf35458) - Fix Pythinker Datasource to use the matching OAuth credentials and service endpoint for the active Pythinker Code environment.

- [#619](https://github.com/PythoughtsAI/pythinker-code/pull/619) [`1fbe0e4`](https://github.com/PythoughtsAI/pythinker-code/commit/1fbe0e4ee89241bee6b5b1d5a4a38b6c6de3c5bf) - Fix goal marker text overflowing terminal width.

- [#612](https://github.com/PythoughtsAI/pythinker-code/pull/612) [`4603d8a`](https://github.com/PythoughtsAI/pythinker-code/commit/4603d8ad6e92a303f396f3d79d4e4d212d1c4b14) - Prevent forking sessions during active turns and consolidate wire protocol definitions into a shared internal package.

- [#540](https://github.com/PythoughtsAI/pythinker-code/pull/540) [`2ebe387`](https://github.com/PythoughtsAI/pythinker-code/commit/2ebe38769fc50215a7c94a362cd4e943130e1143) - Tighten file tool guidance to route incremental edits through Edit.

- [#606](https://github.com/PythoughtsAI/pythinker-code/pull/606) [`a1b419a`](https://github.com/PythoughtsAI/pythinker-code/commit/a1b419ab5901d16ab9527eef62bcd468e76b27a3) - YOLO mode no longer asks before writing or editing files outside the working directory.

## 0.13.0

### Minor Changes

- [#484](https://github.com/PythoughtsAI/pythinker-code/pull/484) [`f863127`](https://github.com/PythoughtsAI/pythinker-code/commit/f863127ab7e8b8e2e9af11c54694c08900e3103a) - Add custom color themes. Define your own palette as a JSON file in `~/.pythinker-code/themes/`, or generate one with the built-in `/custom-theme` skill command.

- [#582](https://github.com/PythoughtsAI/pythinker-code/pull/582) [`d85dc0b`](https://github.com/PythoughtsAI/pythinker-code/commit/d85dc0b96a3c98c6951b8f6e6fa8b663d4c95360) - Add `/import-from-cc-codex` to import selected Claude Code and Codex instructions, Skills, and MCP settings.

- [#593](https://github.com/PythoughtsAI/pythinker-code/pull/593) [`40506f4`](https://github.com/PythoughtsAI/pythinker-code/commit/40506f49d689aaf3e920c6bc9ae2b91219ee3f7f) - Show available plugin updates in the marketplace. An installed plugin whose marketplace version is newer than the local version now renders an `update <local> → <latest>` badge (and updates in place on Enter); up-to-date plugins show `installed · v<version>`. The marketplace `version` served in dev and written by the CDN build is now stamped from each plugin's manifest so "latest" stays accurate.

### Patch Changes

- [#587](https://github.com/PythoughtsAI/pythinker-code/pull/587) [`0abde86`](https://github.com/PythoughtsAI/pythinker-code/commit/0abde8662a531293fc8faa7cf9089c43ad8d6d76) - Clarify grouped subagent progress with active status breakdowns and elapsed time.

- [#594](https://github.com/PythoughtsAI/pythinker-code/pull/594) [`f2863af`](https://github.com/PythoughtsAI/pythinker-code/commit/f2863af267b2e7d5ff5b99ff80c95c379a5b0272) - Fix device login to keep the URL and code visible when the browser cannot be opened.

- [#591](https://github.com/PythoughtsAI/pythinker-code/pull/591) [`e48234a`](https://github.com/PythoughtsAI/pythinker-code/commit/e48234af576e41e630736450c66b690226707bc3) - Fix Windows builds and development launches that could fail when package binaries resolve to command shims.

- [#586](https://github.com/PythoughtsAI/pythinker-code/pull/586) [`7cb4a23`](https://github.com/PythoughtsAI/pythinker-code/commit/7cb4a23e01dfaf0e049891b90a27b36000714151) - Truncate queued message display to a single line with ellipsis when it exceeds terminal width.

## 0.12.1

### Patch Changes

- [#584](https://github.com/PythoughtsAI/pythinker-code/pull/584) [`11bb62c`](https://github.com/PythoughtsAI/pythinker-code/commit/11bb62c12f38d380a0ca1bb89ee2df67f93300e1) - Allow obsolete experimental config entries to remain without blocking startup.

- [#581](https://github.com/PythoughtsAI/pythinker-code/pull/581) [`aa3471f`](https://github.com/PythoughtsAI/pythinker-code/commit/aa3471f5d3d2960834ba3239c0b8459144bc79fa) - Pass through xhigh reasoning effort for OpenAI-compatible chat completions requests.

## 0.12.0

### Minor Changes

- [#569](https://github.com/PythoughtsAI/pythinker-code/pull/569) [`d7407b0`](https://github.com/PythoughtsAI/pythinker-code/commit/d7407b0ecfc87a3840e26ddaddb69e7f52383699) - Enable micro compaction by default while keeping its opt-out flag.

- [#531](https://github.com/PythoughtsAI/pythinker-code/pull/531) [`b47734c`](https://github.com/PythoughtsAI/pythinker-code/commit/b47734ca0bac84e0b2c4ff50cd3d5eedb9e0c7c1) - Detect Homebrew installations and use `brew upgrade pythinker-code` for updates instead of falling back to npm.

- [#487](https://github.com/PythoughtsAI/pythinker-code/pull/487) [`4d11394`](https://github.com/PythoughtsAI/pythinker-code/commit/4d113949c8e906c20c7188817926f44786653923) - Honor the standard `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` environment variables, including SOCKS proxies, for all outbound traffic.

- [#569](https://github.com/PythoughtsAI/pythinker-code/pull/569) [`d7407b0`](https://github.com/PythoughtsAI/pythinker-code/commit/d7407b0ecfc87a3840e26ddaddb69e7f52383699) - Make goals, background questions, and sub-skill discovery available without experimental opt-ins.

- [#424](https://github.com/PythoughtsAI/pythinker-code/pull/424) [`72c4b0a`](https://github.com/PythoughtsAI/pythinker-code/commit/72c4b0adaa6ae0466875cd8e4066c42456195f21) - Add the `/swarm` command for running agent swarms with live progress and rate-limit-aware retries.

### Patch Changes

- [#395](https://github.com/PythoughtsAI/pythinker-code/pull/395) [`879a7ee`](https://github.com/PythoughtsAI/pythinker-code/commit/879a7eeb33a8bedf18779d74a00d78369dae3db5) - Fix ACP slash skill routing, bootstrap context reads, file and permission edge cases, subagent event handling, and stale-file edit messaging.

- [#529](https://github.com/PythoughtsAI/pythinker-code/pull/529) [`3b62b12`](https://github.com/PythoughtsAI/pythinker-code/commit/3b62b123e68cc4543bfa8fa376c7e8a24fee0afb) - Detect Git Bash installed through Scoop and other Git shims on Windows.

- [#547](https://github.com/PythoughtsAI/pythinker-code/pull/547) [`3765a49`](https://github.com/PythoughtsAI/pythinker-code/commit/3765a491636a57c0f84ba409c325df10f7613a49) - Rework file reference completion in the TUI.

- [#537](https://github.com/PythoughtsAI/pythinker-code/pull/537) [`8d0c91f`](https://github.com/PythoughtsAI/pythinker-code/commit/8d0c91faa1c878e395bffe9bafa89e10736c2384) - Wrap long single-line shell commands in approval prompts so the full command remains visible.

- [#552](https://github.com/PythoughtsAI/pythinker-code/pull/552) [`db82e33`](https://github.com/PythoughtsAI/pythinker-code/commit/db82e33a20fd1ec204672df4ba5bc38800ce8dea) - Fix goal resume behavior by restoring goal state from agent records.

- [#521](https://github.com/PythoughtsAI/pythinker-code/pull/521) [`9aba465`](https://github.com/PythoughtsAI/pythinker-code/commit/9aba465fd8689be998fa8581d04792b3c7c54359) - Fix the `/mcp` status panel border being broken by multi-line MCP server errors, which are now folded onto a single row.

- [#543](https://github.com/PythoughtsAI/pythinker-code/pull/543) [`0c3d556`](https://github.com/PythoughtsAI/pythinker-code/commit/0c3d556778f969b3c99e69e07ecba27af8bd6c29) - Fix session workdir mismatch on Windows caused by inconsistent path separators.

- [#544](https://github.com/PythoughtsAI/pythinker-code/pull/544) [`5cff6d6`](https://github.com/PythoughtsAI/pythinker-code/commit/5cff6d60273a6145ee38539b9c1306adddc66510) - Load Pythinker-specific user Skills and global agent instructions from `PYTHINKER_CODE_HOME` when it is set.

- [#536](https://github.com/PythoughtsAI/pythinker-code/pull/536) [`b785e26`](https://github.com/PythoughtsAI/pythinker-code/commit/b785e2698a2da7adc9ef10251a2aed9b243e3b5f) - Show full plan cards directly and remove the Plan card keyboard shortcut.

- [#555](https://github.com/PythoughtsAI/pythinker-code/pull/555) [`41ebe9f`](https://github.com/PythoughtsAI/pythinker-code/commit/41ebe9fb9f403e2ee6a8721640a79faa64e9210a) - Improve goal mode outcome handling with follow-up messages, safer error pauses, and clearer TUI transcript display.

- [#506](https://github.com/PythoughtsAI/pythinker-code/pull/506) [`f09ec7b`](https://github.com/PythoughtsAI/pythinker-code/commit/f09ec7bbb59af42805a93df2993301dbd317ff2d) - Remove the per-turn auto-compaction limit so long conversations can keep compacting instead of failing early.

- [#473](https://github.com/PythoughtsAI/pythinker-code/pull/473) [`3787c30`](https://github.com/PythoughtsAI/pythinker-code/commit/3787c3016a12af3434072da1cb6fd0c95821ea45) - Allow the startup session picker to exit with repeated Ctrl-C or Ctrl-D.

- [#210](https://github.com/PythoughtsAI/pythinker-code/pull/210) [`d995928`](https://github.com/PythoughtsAI/pythinker-code/commit/d995928681fa2446902a0164919cf893b81efd75) - Show the underlying error when migration fails.

- [#541](https://github.com/PythoughtsAI/pythinker-code/pull/541) [`2db1bd9`](https://github.com/PythoughtsAI/pythinker-code/commit/2db1bd9675ef3b6adf3833f05b7b6d87a137c6eb) - Fix thinking text and tool output display for subagents.

## 0.11.0

### Minor Changes

- [#468](https://github.com/PythoughtsAI/pythinker-code/pull/468) [`df4f2d6`](https://github.com/PythoughtsAI/pythinker-code/commit/df4f2d6e8611074cc0b439928f27decba53d2e9a) - Add experimental sub-skill discovery gated by the `PYTHINKER_CODE_EXPERIMENTAL_SUB_SKILL` environment variable. Ships the `sub-skill` builtin bundle (`sub-skill.review`, `sub-skill.consolidate`) for inventorying and consolidating skills into hierarchical groups.

- [#480](https://github.com/PythoughtsAI/pythinker-code/pull/480) [`f555c89`](https://github.com/PythoughtsAI/pythinker-code/commit/f555c89de79c5d7ae59521a9ed360ad1cf045fcd) - Show built-in skills as direct slash commands and group them ahead of external skill commands.

- [#458](https://github.com/PythoughtsAI/pythinker-code/pull/458) [`93eb70a`](https://github.com/PythoughtsAI/pythinker-code/commit/93eb70a727c9724e19a31b0d2fbebb78b7390c78) - Migrate still-relevant environment variables from pythinker-cli:

  - `PYTHINKER_MODEL_TEMPERATURE`, `PYTHINKER_MODEL_TOP_P` — sampling parameters applied globally to any `pythinker` provider (not tied to `PYTHINKER_MODEL_NAME`).
  - `PYTHINKER_MODEL_THINKING_KEEP` — Pythoughts preserved-thinking passthrough (`thinking.keep`), injected only while Thinking is on.
  - `PYTHINKER_CODE_NO_AUTO_UPDATE` (legacy alias `PYTHINKER_CLI_NO_AUTO_UPDATE`) — fully disables the update preflight (no check, background install, or prompt).

- [#470](https://github.com/PythoughtsAI/pythinker-code/pull/470) [`aa610e2`](https://github.com/PythoughtsAI/pythinker-code/commit/aa610e247deca737101e4de848122db1c8ee9fb3) - Use a fixed 30-minute timeout for subagents and show concise resume instructions when they time out.

### Patch Changes

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Show the upcoming-goal confirmation with the same accent treatment as goal lifecycle messages.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Fix slash command autocomplete so goal text can be submitted when the cursor is before existing text.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Fix queued goals so failed promotion attempts do not lose or duplicate queued work.

- [#456](https://github.com/PythoughtsAI/pythinker-code/pull/456) [`3a98713`](https://github.com/PythoughtsAI/pythinker-code/commit/3a987130500fe5b403b696850165735c7d0ee076) - Show concise provider filtering errors when responses are blocked before visible output.

- [#442](https://github.com/PythoughtsAI/pythinker-code/pull/442) [`960a0e2`](https://github.com/PythoughtsAI/pythinker-code/commit/960a0e2885b5a6a32ccd62506e9dcf4e35206b6f) - Show "unknown command" instead of "too many arguments" when an invalid subcommand is entered.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Fix upcoming-goal queue handling while editing or pasting queued goals.

- [#457](https://github.com/PythoughtsAI/pythinker-code/pull/457) [`1fe5d55`](https://github.com/PythoughtsAI/pythinker-code/commit/1fe5d5549c84de17183c4c76a9713cd8538ca755) - Clamp OpenAI Chat Completions `xhigh` and `max` thinking effort to `high` unless the model supports `xhigh` on `v1/chat/completions`.

- [#464](https://github.com/PythoughtsAI/pythinker-code/pull/464) [`4f9977d`](https://github.com/PythoughtsAI/pythinker-code/commit/4f9977d4dcd2df14e6a310396c37af170b2eac50) - Preserve thinking effort when compacting long conversations.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Ask before starting goals in YOLO mode so users can switch to Auto for unattended work.

- [#461](https://github.com/PythoughtsAI/pythinker-code/pull/461) [`2af19e2`](https://github.com/PythoughtsAI/pythinker-code/commit/2af19e29b9f49163b23cade71d3bcaa6d0b11773) - Refresh provider model metadata when capabilities change without model ID changes.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Start upcoming goals immediately when there is no active goal to wait for.
  Support multiline edits when managing upcoming goals.

- [#474](https://github.com/PythoughtsAI/pythinker-code/pull/474) [`658e465`](https://github.com/PythoughtsAI/pythinker-code/commit/658e4653fc535dad040ac3406d8ccace7a19077e) - Highlight goal queue subcommands while typing slash commands.

## 0.10.1

### Patch Changes

- [#443](https://github.com/PythoughtsAI/pythinker-code/pull/443) [`15a4c64`](https://github.com/PythoughtsAI/pythinker-code/commit/15a4c64e5cea45c9f72d8c889f306f1f964a8ac6) - Fix a crash when starting a goal in the TUI.

## 0.10.0

### Minor Changes

- [#433](https://github.com/PythoughtsAI/pythinker-code/pull/433) [`85338e9`](https://github.com/PythoughtsAI/pythinker-code/commit/85338e9f7df5d98234fd42891e9bf2a2e6ad767b) - Add the built-in `update-config` skill — you can now have Pythinker edit its own config files.

- [#420](https://github.com/PythoughtsAI/pythinker-code/pull/420) [`86a42a2`](https://github.com/PythoughtsAI/pythinker-code/commit/86a42a26a1e01f1748a937031fa76ebeaa1e28a8) - Add persistent experimental feature toggles and a TUI panel that applies confirmed changes by reloading the current session.

- [#383](https://github.com/PythoughtsAI/pythinker-code/pull/383) [`15d71b5`](https://github.com/PythoughtsAI/pythinker-code/commit/15d71b5130d949c35d9dc2641e807e08d72dce48) - Add /reload to reload the current session and apply updated config files, plus /reload-tui to reload only TUI preferences.

- [#393](https://github.com/PythoughtsAI/pythinker-code/pull/393) [`beb12ac`](https://github.com/PythoughtsAI/pythinker-code/commit/beb12ac0216818a5c5eda24fb304e4ab01792784) - Users now can prepare several goals for the agent to work on sequentially. The agent will pick up the next goal from the queue once the current goal is completed. Use `/goal next <objective>` to queue a goal and `/goal next manage` to review and change the queue interactively.

- [#431](https://github.com/PythoughtsAI/pythinker-code/pull/431) [`6a4e4c7`](https://github.com/PythoughtsAI/pythinker-code/commit/6a4e4c75d4bf6db3fefbb5c115d7a7c324bcae16) - Add a doctor command for validating Pythinker Code configuration files.

### Patch Changes

- [#393](https://github.com/PythoughtsAI/pythinker-code/pull/393) [`beb12ac`](https://github.com/PythoughtsAI/pythinker-code/commit/beb12ac0216818a5c5eda24fb304e4ab01792784) - Stop carrying active and queued goals into forked sessions.

- [#408](https://github.com/PythoughtsAI/pythinker-code/pull/408) [`6303bd2`](https://github.com/PythoughtsAI/pythinker-code/commit/6303bd2936ae168c674af6e685b0eed5a890c42f) - Point session error diagnostics to the `/export-debug-zip` command.

- [#398](https://github.com/PythoughtsAI/pythinker-code/pull/398) [`b2801c4`](https://github.com/PythoughtsAI/pythinker-code/commit/b2801c4dbfe3f7e13f5468bfba1555fa12d1707c) - Set terminal tab titles without renaming the running process.

- [#403](https://github.com/PythoughtsAI/pythinker-code/pull/403) [`d645d7e`](https://github.com/PythoughtsAI/pythinker-code/commit/d645d7e443857b3c974b9fd6065027c0f0cd6953) - Start automatic background updates as soon as startup's fresh update check finds a newer version.

- [#387](https://github.com/PythoughtsAI/pythinker-code/pull/387) [`6e74027`](https://github.com/PythoughtsAI/pythinker-code/commit/6e74027fdc48ad124b2a62465bb5fd07e84d4712) - Lowercase the stale file content message in edit tool errors.

- [#428](https://github.com/PythoughtsAI/pythinker-code/pull/428) [`853c5fc`](https://github.com/PythoughtsAI/pythinker-code/commit/853c5fc43741582ecbde3b4fccf82cddffe3626e) - Ensure Nix-packaged CLI builds can find ripgrep and fd.

- [#411](https://github.com/PythoughtsAI/pythinker-code/pull/411) [`4598262`](https://github.com/PythoughtsAI/pythinker-code/commit/459826292f855592288bcfddaa1c72529a6d8c64) - Normalize malformed Responses stream rate limit errors as provider rate limit failures.

- [#405](https://github.com/PythoughtsAI/pythinker-code/pull/405) [`07e2e0f`](https://github.com/PythoughtsAI/pythinker-code/commit/07e2e0f094fcbc8a6026eb53f5a70cc437bf7c52) - Refresh the update target before showing foreground update prompts so the displayed version matches the install.

- [#399](https://github.com/PythoughtsAI/pythinker-code/pull/399) [`232ed87`](https://github.com/PythoughtsAI/pythinker-code/commit/232ed874d41de777e6ff9c539ac22d830d0b5c3a) - Keep managed OAuth credentials scoped to their configured authentication and API endpoints.

- [#407](https://github.com/PythoughtsAI/pythinker-code/pull/407) [`07609b4`](https://github.com/PythoughtsAI/pythinker-code/commit/07609b41a31499bb5c7811dbab71fa427e621efc) - Set the CLI process title to pythinker-code during startup.

- [#419](https://github.com/PythoughtsAI/pythinker-code/pull/419) [`d0f8e24`](https://github.com/PythoughtsAI/pythinker-code/commit/d0f8e24e9b4d2c6dd68d93bc804a4390bf661c10) - Document the Git Bash prerequisite for Windows installs.

- [#430](https://github.com/PythoughtsAI/pythinker-code/pull/430) [`be0da5f`](https://github.com/PythoughtsAI/pythinker-code/commit/be0da5ff39641e117d60045a43a7d5d2e0b85b75) - Fail early when Git Bash is missing on Windows before starting CLI sessions.

## 0.9.0

### Minor Changes

- [#368](https://github.com/PythoughtsAI/pythinker-code/pull/368) [`3eafa79`](https://github.com/PythoughtsAI/pythinker-code/commit/3eafa79f39c06b67d18bd2c1fd5321d2d889ed90) - Add `@pythoughts/acp-adapter` and the `pythinker acp` subcommand: pythinker-code now speaks [Agent Client Protocol 0.23](https://agentclientprotocol.com/) over stdio so IDEs (Zed, JetBrains AI Chat, custom clients) can drive sessions directly — coverage matrix, Zed configuration and breaking pre-release notes are in [pythinker acp Subcommand Page](https://pythoughtsai.github.io/pythinker-code/en/reference/pythinker-acp.html).

- [#338](https://github.com/PythoughtsAI/pythinker-code/pull/338) [`ba7dd73`](https://github.com/PythoughtsAI/pythinker-code/commit/ba7dd736a3b295b2a29c229a944208c232d51458) - Add `/btw` for side-channel conversations without steering the active main turn.

- [#357](https://github.com/PythoughtsAI/pythinker-code/pull/357) [`179aecf`](https://github.com/PythoughtsAI/pythinker-code/commit/179aecf42379e8ef4091f5351c91cd460ba11bdd) - Log enabled experimental flags at startup.

- [#378](https://github.com/PythoughtsAI/pythinker-code/pull/378) [`e0d28b4`](https://github.com/PythoughtsAI/pythinker-code/commit/e0d28b4941ad6f16e69bdf56a4185655feec5320) - Allow `/btw` to open the side-channel panel before entering a question.

### Patch Changes

- [#246](https://github.com/PythoughtsAI/pythinker-code/pull/246) [`7d1f889`](https://github.com/PythoughtsAI/pythinker-code/commit/7d1f889d3dc123f44a8d14543e5aaf8aeef2c752) - Fix external editor (Ctrl+G) on Windows by removing `/bin/sh` dependency and using platform-aware shell quoting for temp file paths.

- [#365](https://github.com/PythoughtsAI/pythinker-code/pull/365) [`6a22523`](https://github.com/PythoughtsAI/pythinker-code/commit/6a2252343a0d624b326b2d369ec908bc8d60092d) - Fix goal budget tool schemas for OpenAI-compatible providers.

- [#365](https://github.com/PythoughtsAI/pythinker-code/pull/365) [`6a22523`](https://github.com/PythoughtsAI/pythinker-code/commit/6a2252343a0d624b326b2d369ec908bc8d60092d) - Use the OpenAI completion token field required by newer Chat Completions models.

- [#380](https://github.com/PythoughtsAI/pythinker-code/pull/380) [`8639105`](https://github.com/PythoughtsAI/pythinker-code/commit/86391053139ad4ea437afe79f472412fb1b106a1) - Resume saved subagents lazily when they are accessed.

- [#339](https://github.com/PythoughtsAI/pythinker-code/pull/339) [`a6b16ce`](https://github.com/PythoughtsAI/pythinker-code/commit/a6b16ce6b4bdc20ed33888975c7da7ff1919e22f) - Allow SDK runtime creation to use a separate RPC client while preserving local CLI startup.

- [#363](https://github.com/PythoughtsAI/pythinker-code/pull/363) [`90879f3`](https://github.com/PythoughtsAI/pythinker-code/commit/90879f37af2ddb941223d293a67615f8f557e3af) - Unify the interaction and visuals across TUI dialogs and selectors.

- [#365](https://github.com/PythoughtsAI/pythinker-code/pull/365) [`6a22523`](https://github.com/PythoughtsAI/pythinker-code/commit/6a2252343a0d624b326b2d369ec908bc8d60092d) - Use configured model output limits for completion token caps.

## 0.8.0

### Minor Changes

- [#319](https://github.com/PythoughtsAI/pythinker-code/pull/319) [`fe7db4a`](https://github.com/PythoughtsAI/pythinker-code/commit/fe7db4a7e361b83194eb1ebb52d27daed53be532) - Append the current todo list as markdown to compaction summaries before writing them to history.

- [#334](https://github.com/PythoughtsAI/pythinker-code/pull/334) [`eeefa98`](https://github.com/PythoughtsAI/pythinker-code/commit/eeefa98083e9d037d2ba7c59de9e5eb51b19fdd7) - Add background automatic upgrades, which can be disabled in tui.toml.

- [#270](https://github.com/PythoughtsAI/pythinker-code/pull/270) [`ac37d74`](https://github.com/PythoughtsAI/pythinker-code/commit/ac37d7448458fdb73fbe00e35856dcf44a13f734) - Add experimental goal mode for longer tasks that need more than one turn. Turn it on with `PYTHINKER_CODE_EXPERIMENTAL_GOAL_COMMAND=1` before you start Pythinker.

  Use `/goal <objective>` in the TUI when you want Pythinker to keep working on one task across turns. For example:

  ```text
  /goal Fix the failing checkout test
  ```

  Pythinker shows the goal in the TUI and keeps progress visible while it works. Use `/goal status`, `/goal pause`, `/goal resume`, `/goal cancel`, and `/goal replace <objective>` to manage the goal. This feature is still experimental. Try it and tell us what would make it more useful.

- [#315](https://github.com/PythoughtsAI/pythinker-code/pull/315) [`191059d`](https://github.com/PythoughtsAI/pythinker-code/commit/191059d40049d3bfd07661ac03bb961eac1407f7) - Add background structured questions so agents can continue while waiting for user answers.

- [#313](https://github.com/PythoughtsAI/pythinker-code/pull/313) [`3c5dee8`](https://github.com/PythoughtsAI/pythinker-code/commit/3c5dee8836ac823fce01707f60b9c095a963060e) - Add `pythinker provider` CLI subcommand with `add`, `remove`, `list`, and `catalog list` / `catalog add` actions, so providers from a custom registry (api.json) or the public models.dev catalog can be imported and managed without launching the TUI.

- [#277](https://github.com/PythoughtsAI/pythinker-code/pull/277) [`a217ff0`](https://github.com/PythoughtsAI/pythinker-code/commit/a217ff09aad0665b1501b156c2cc1f186b876087) - Add `/undo` slash command to withdraw the last prompt from conversation history, and keep replay records in sync when a prompt is undone.

- [#334](https://github.com/PythoughtsAI/pythinker-code/pull/334) [`eeefa98`](https://github.com/PythoughtsAI/pythinker-code/commit/eeefa98083e9d037d2ba7c59de9e5eb51b19fdd7) - Add a `pythinker upgrade` command for manually checking and upgrade Pythinker Code CLI.

- [#336](https://github.com/PythoughtsAI/pythinker-code/pull/336) [`7cda9c3`](https://github.com/PythoughtsAI/pythinker-code/commit/7cda9c3866bad6b3ce8f95c383a111e1ee5e9325) - Add approval lifecycle hook events for observing pending and completed permission prompts.

### Patch Changes

- [#285](https://github.com/PythoughtsAI/pythinker-code/pull/285) [`573c56e`](https://github.com/PythoughtsAI/pythinker-code/commit/573c56e829a10e8a45738a37250d8c15f4ab8d8d) - Consolidate background task management under the agent background runtime.

- [#314](https://github.com/PythoughtsAI/pythinker-code/pull/314) [`6de3d97`](https://github.com/PythoughtsAI/pythinker-code/commit/6de3d97d82e2c585035d1d7f969a3504f712df21) - Prevent modified keyboard release sequences from appearing after exiting the CLI.

- [#335](https://github.com/PythoughtsAI/pythinker-code/pull/335) [`7284f30`](https://github.com/PythoughtsAI/pythinker-code/commit/7284f30479142fd66b1e8a731fd00198b1e8684f) - Fix custom registry provider handling during re-import. Prevent loss of multi-provider entries and remove stale providers along with their model aliases and default model references.

- [#311](https://github.com/PythoughtsAI/pythinker-code/pull/311) [`80164c2`](https://github.com/PythoughtsAI/pythinker-code/commit/80164c2e975ba82f7c915dc3fce6cb00b9d29f6e) - Normalize glob patterns before brace expansion to prevent incorrect path matching.

- [#247](https://github.com/PythoughtsAI/pythinker-code/pull/247) [`58e2915`](https://github.com/PythoughtsAI/pythinker-code/commit/58e2915c0f726747a94a8dc5a9eda001ef0d4009) - Fix a crash in the `/sessions` picker on very narrow terminals by clamping every rendered line to the terminal width.

- [#317](https://github.com/PythoughtsAI/pythinker-code/pull/317) [`1f8c36a`](https://github.com/PythoughtsAI/pythinker-code/commit/1f8c36af288ca6120d620f3944c921bc4f0f77ce) - Fix tool output preview rendering: trim trailing empty lines, append ellipsis to multi-line Bash command headers, and truncate long single-line output by visual wrapped lines instead of raw newline count.

- [#145](https://github.com/PythoughtsAI/pythinker-code/pull/145) [`d912053`](https://github.com/PythoughtsAI/pythinker-code/commit/d912053b0d3983f4e67450c347616086cfbd1fe7) - Fix Git Bash path detection on Windows by also searching `usr\bin\bash.exe` locations, which is where bash lives in many Git for Windows installations where `bin\bash.exe` does not exist.

- [#310](https://github.com/PythoughtsAI/pythinker-code/pull/310) [`a4511ff`](https://github.com/PythoughtsAI/pythinker-code/commit/a4511ffc87a1414cb8a5295eeef1103b9ed59645) - Show the full model name in the footer status bar instead of truncating the provider prefix.

- [#283](https://github.com/PythoughtsAI/pythinker-code/pull/283) [`91b292e`](https://github.com/PythoughtsAI/pythinker-code/commit/91b292e898e9d97b0501cf787919d7f1a90c89d8) - Allow glob searches to target explicit absolute paths outside the workspace.

- [#223](https://github.com/PythoughtsAI/pythinker-code/pull/223) [`811f252`](https://github.com/PythoughtsAI/pythinker-code/commit/811f252625bc20a27687b11754b18cc68c7d50dc) - Show MCP server summary in the welcome panel and add configuration hints in the /mcp command output.

- [#229](https://github.com/PythoughtsAI/pythinker-code/pull/229) [`fb35bca`](https://github.com/PythoughtsAI/pythinker-code/commit/fb35bca032486eaefb7b9d7b612d353033e0922c) - Replace chalk named color with theme-aware hex in session-directory warning.

- [#303](https://github.com/PythoughtsAI/pythinker-code/pull/303) [`3d7e20e`](https://github.com/PythoughtsAI/pythinker-code/commit/3d7e20e6978cb35787738e12f6f352fbc2733582) - Point users to `/provider` instead of the removed `/connect` command in the welcome screen and the no-models-configured hint.

- [#135](https://github.com/PythoughtsAI/pythinker-code/pull/135) [`0071b63`](https://github.com/PythoughtsAI/pythinker-code/commit/0071b63fc83821430472e11db3c6aa613c0bdf7e) - Fix slash-activated skills not being recognized by the model due to missing system reminder wrapper.

- [#330](https://github.com/PythoughtsAI/pythinker-code/pull/330) [`7a47045`](https://github.com/PythoughtsAI/pythinker-code/commit/7a47045af2790eba0e68d5406c670ac759b21755) - Allow subagents to use custom tools registered on their parent agent.

- [#333](https://github.com/PythoughtsAI/pythinker-code/pull/333) [`1178c5c`](https://github.com/PythoughtsAI/pythinker-code/commit/1178c5cd148d9d5851574afaafb986be1dfe9b63) - Remind the model to refresh TodoList during long-running tasks and strengthen TodoList progress-tracking guidance.

- [#327](https://github.com/PythoughtsAI/pythinker-code/pull/327) [`8809f3e`](https://github.com/PythoughtsAI/pythinker-code/commit/8809f3eb114172ac64cefe43bbf9b9257c5245c0) - Fix cross-provider replay failures from incompatible tool call IDs and unsigned Claude thinking history.

## 0.7.0

### Minor Changes

- [#232](https://github.com/PythoughtsAI/pythinker-code/pull/232) [`a24bfb1`](https://github.com/PythoughtsAI/pythinker-code/commit/a24bfb1df38e58120827a1d8ed881724af2e7b23) - Add `PYTHINKER_MODEL_ADAPTIVE_THINKING` (and a matching `adaptive_thinking` model-alias field) to force adaptive thinking (`thinking: { type: 'adaptive' }`) on or off, overriding the Anthropic model-name version inference. This lets custom-named compatible endpoints that back an adaptive-capable model opt in even when the model name does not encode a parseable Claude version.

- [#264](https://github.com/PythoughtsAI/pythinker-code/pull/264) [`42bb914`](https://github.com/PythoughtsAI/pythinker-code/commit/42bb9141d8ee7023639f943dd4c6a0f6c8fa8945) - Add `/provider` command for managing AI providers, support custom registry imports, and introduce a tabbed model selector.

- [#204](https://github.com/PythoughtsAI/pythinker-code/pull/204) [`ee69d0a`](https://github.com/PythoughtsAI/pythinker-code/commit/ee69d0ac29f56bde4957c14767d7ca436697d9cf) - Render scheduled reminders distinctly in the TUI, expose cron fired events to SDK clients, and report cron fire times with local timezone offsets.

### Patch Changes

- [#282](https://github.com/PythoughtsAI/pythinker-code/pull/282) [`a580cd3`](https://github.com/PythoughtsAI/pythinker-code/commit/a580cd3a98664e18642e0e856aeaa9b71ba93516) - Fix glob pattern backslash escaping and include match count in truncation messages.

- [#260](https://github.com/PythoughtsAI/pythinker-code/pull/260) [`178827d`](https://github.com/PythoughtsAI/pythinker-code/commit/178827db47f183df783ba63bf8f1c338f2cbd7e6) - Polish a small TUI visual interaction.

- [#267](https://github.com/PythoughtsAI/pythinker-code/pull/267) [`e2e1728`](https://github.com/PythoughtsAI/pythinker-code/commit/e2e17289fca9bcb23f05cd77f7bcb9cba5db0325) - Report truncated compaction summaries clearly and apply valid completion token budgets across supported providers.

- [#274](https://github.com/PythoughtsAI/pythinker-code/pull/274) [`a1dfbfe`](https://github.com/PythoughtsAI/pythinker-code/commit/a1dfbfeb16bcad0c2c8faa232d6d1ce4a2681d57) - Clarify Pythinker Platform API key login labels and prompt details.

## 0.6.0

### Minor Changes

- [#212](https://github.com/PythoughtsAI/pythinker-code/pull/212) [`2bbea75`](https://github.com/PythoughtsAI/pythinker-code/commit/2bbea75ee4c0b11f12d2921061774426df40479a) - Add a `PYTHINKER_MODEL_*` environment-variable channel that lets you run Pythinker Code against a specific model (provider type, base URL, API key, context size, capabilities, and thinking settings) without editing `config.toml`.

- [#221](https://github.com/PythoughtsAI/pythinker-code/pull/221) [`bab2da7`](https://github.com/PythoughtsAI/pythinker-code/commit/bab2da7b1c785d6deba25decb1411f8f5a70de8c) - Install plugins directly from GitHub repository URLs, and surface each install's origin and trust level (pythinker-official, curated, third-party) in the plugin manager.

- [#118](https://github.com/PythoughtsAI/pythinker-code/pull/118) [`8913440`](https://github.com/PythoughtsAI/pythinker-code/commit/891344054111a05171963cfa524ef749c2855321) - Support querying sessions by sessionId or workDir in listSessions, and show a helpful cd command when resuming a session from a different working directory.

- [#186](https://github.com/PythoughtsAI/pythinker-code/pull/186) [`537cf20`](https://github.com/PythoughtsAI/pythinker-code/commit/537cf20d18b26d4238f963f793f8a8ef085ac97e) - Remove the default per-turn step limit of 1000. Users can still set `max_steps_per_turn` in config to enforce a custom limit.

### Patch Changes

- [#197](https://github.com/PythoughtsAI/pythinker-code/pull/197) [`f3269ea`](https://github.com/PythoughtsAI/pythinker-code/commit/f3269eacb9da9a6b66f578a864d0b9bdfb1d6d81) - Show the real terminal status of background agents in the transcript so lost, failed, and killed ones no longer appear as completed, and include the resume agent id and recovery instructions in the failure notification so the model can resume reliably.

- [#211](https://github.com/PythoughtsAI/pythinker-code/pull/211) [`54590d3`](https://github.com/PythoughtsAI/pythinker-code/commit/54590d3d464b05eed0837a725b37f3aa491c09af) - Back off failed compaction retries by a fixed slice of the model context window.

- [#167](https://github.com/PythoughtsAI/pythinker-code/pull/167) [`b5981a5`](https://github.com/PythoughtsAI/pythinker-code/commit/b5981a523b66ff2fd5f09a7e66075628b94683c8) - Introduce `ModelProvider` interface and `SingleModelProvider` to decouple `Agent` from `ProviderManager`.

- [#213](https://github.com/PythoughtsAI/pythinker-code/pull/213) [`2388f20`](https://github.com/PythoughtsAI/pythinker-code/commit/2388f20bb3d039e89caefca159801059b90dc64a) - Handle context overflow errors consistently across provider responses.

- [#214](https://github.com/PythoughtsAI/pythinker-code/pull/214) [`caaa6d8`](https://github.com/PythoughtsAI/pythinker-code/commit/caaa6d83ee262ba4c954386458ee13aacdb26e1a) - Fix the native self-updater reporting a successful update when the install command actually failed.

- [#202](https://github.com/PythoughtsAI/pythinker-code/pull/202) [`14a0348`](https://github.com/PythoughtsAI/pythinker-code/commit/14a03488555682dde4bcd74aadf79f60a9827304) - Fix footer leaking onto the terminal when resuming a non-existent session.

- [#198](https://github.com/PythoughtsAI/pythinker-code/pull/198) [`8c77cfa`](https://github.com/PythoughtsAI/pythinker-code/commit/8c77cfab62617e07b38f8514a8ef7cddfd9f1069) - Fix automatic ripgrep installation when temporary files are on another filesystem.

- [#199](https://github.com/PythoughtsAI/pythinker-code/pull/199) [`588145d`](https://github.com/PythoughtsAI/pythinker-code/commit/588145dc9b266456bdb1d739975a5b9cf33d70ae) - Expand the footer's rotating tips to surface more commands and shortcuts, featuring newer and important ones more prominently.

- [#192](https://github.com/PythoughtsAI/pythinker-code/pull/192) [`64964a0`](https://github.com/PythoughtsAI/pythinker-code/commit/64964a0dda98fc2db5e15ba923ea9414c78e0009) - Improve the usage information display in the TUI.

- [#195](https://github.com/PythoughtsAI/pythinker-code/pull/195) [`3a0e060`](https://github.com/PythoughtsAI/pythinker-code/commit/3a0e06031ac6dfde148f64906a06cfe820ad9c63) - Project persisted hook and blocked prompt messages into model context.

- [#221](https://github.com/PythoughtsAI/pythinker-code/pull/221) [`bab2da7`](https://github.com/PythoughtsAI/pythinker-code/commit/bab2da7b1c785d6deba25decb1411f8f5a70de8c) - Restrict plugin trust badges to Pythinker-hosted plugin CDN URL patterns.

- [#207](https://github.com/PythoughtsAI/pythinker-code/pull/207) [`e280f33`](https://github.com/PythoughtsAI/pythinker-code/commit/e280f33daf7fbf1271c872dcb224737ec9518f73) - Recover from provider model token limit errors during long conversations.

- [#201](https://github.com/PythoughtsAI/pythinker-code/pull/201) [`3da4dae`](https://github.com/PythoughtsAI/pythinker-code/commit/3da4daeadee39573c7eeede30fa9465b411be3e2) - Automatically retry when a model response stream is dropped mid-flight (a `terminated` error) instead of failing the turn.

- [#190](https://github.com/PythoughtsAI/pythinker-code/pull/190) [`1873859`](https://github.com/PythoughtsAI/pythinker-code/commit/1873859b0ef093a956dfd19e1530e920e7118160) - Slim the LLM diagnostic logs with fewer, more compact fields.

- [#185](https://github.com/PythoughtsAI/pythinker-code/pull/185) [`114777e`](https://github.com/PythoughtsAI/pythinker-code/commit/114777e859680f807375760271533e2dc396af5d) - Split `RuntimeConfig` into `Kaos` and `ToolServices` and update all references accordingly.

- [#189](https://github.com/PythoughtsAI/pythinker-code/pull/189) [`564721f`](https://github.com/PythoughtsAI/pythinker-code/commit/564721fe16e582b2774835b01dec799cbb1d0122) - Clarify subagent and background task stop messages as user-initiated.

- [#206](https://github.com/PythoughtsAI/pythinker-code/pull/206) [`07d51e4`](https://github.com/PythoughtsAI/pythinker-code/commit/07d51e4add6ee23a56fb8745aa7754f05f3d6d36) - Relocate shared tool service typing to the tool support layer.

- [#215](https://github.com/PythoughtsAI/pythinker-code/pull/215) [`b9860e9`](https://github.com/PythoughtsAI/pythinker-code/commit/b9860e9f6ec65eb5dfdabbad54f1a87d69f4f00a) - Align the datasource plugin with the generic two-tool workflow.

- [#200](https://github.com/PythoughtsAI/pythinker-code/pull/200) [`5159af3`](https://github.com/PythoughtsAI/pythinker-code/commit/5159af341c7d388a158e41afb470a2281333f329) - Keep blocked prompt hook conversations available to subsequent model turns.

## 0.5.0

### Minor Changes

- [#163](https://github.com/PythoughtsAI/pythinker-code/pull/163) [`07dd604`](https://github.com/PythoughtsAI/pythinker-code/commit/07dd604c3c7f453dfb0c0a601bb1c44a8114bb3b) - Add `/auto` slash command and `--auto` CLI flag for auto permission mode.

- [#157](https://github.com/PythoughtsAI/pythinker-code/pull/157) [`971fce6`](https://github.com/PythoughtsAI/pythinker-code/commit/971fce6e528c2b210df1852d7cd12bcda71014fd) - Add scheduled tasks:

  You can now ask the agent to remind you at a specific time, run a task on a recurring cron schedule (for example, check a deploy every 5 minutes or run a daily report every weekday at 9am), or come back on its own in a few minutes to continue what it was doing.

  Schedules use the standard 5-field cron syntax.

### Patch Changes

- [#162](https://github.com/PythoughtsAI/pythinker-code/pull/162) [`f3c1015`](https://github.com/PythoughtsAI/pythinker-code/commit/f3c1015b677d40fb94957ab121da5e14480a890f) - Add a clickable changelog link to the update prompt.

- [#150](https://github.com/PythoughtsAI/pythinker-code/pull/150) [`8b5a251`](https://github.com/PythoughtsAI/pythinker-code/commit/8b5a25161ceac02894d1a09c78a5aa883e460c8e) - Show the full Bash command when expanding a Bash tool card with `ctrl+o`. The header still truncates long commands at 60 chars, but the expanded view now reveals the complete multi-line command above the output.

- [#158](https://github.com/PythoughtsAI/pythinker-code/pull/158) [`d1f9a83`](https://github.com/PythoughtsAI/pythinker-code/commit/d1f9a83d7af16ab78b7da571b3de146767864f3a) - Shorten the session title written to the terminal window/tab from 80 to 32 characters so long first messages and pasted content no longer stretch the tab bar past readable width.

- [#146](https://github.com/PythoughtsAI/pythinker-code/pull/146) [`76cbf86`](https://github.com/PythoughtsAI/pythinker-code/commit/76cbf86e2035f905242d30009052254eee52bcf8) - Cap the inline todo panel at five rows and show a `+N more` indicator so long task lists no longer fill the screen.

- [#120](https://github.com/PythoughtsAI/pythinker-code/pull/120) [`8515472`](https://github.com/PythoughtsAI/pythinker-code/commit/85154724764a3478bfc0ef40d8b5a1def5063ec7) - Fix compaction to handle edge cases where no messages are compactable and improve retry logic.

- [#159](https://github.com/PythoughtsAI/pythinker-code/pull/159) [`c88b7bf`](https://github.com/PythoughtsAI/pythinker-code/commit/c88b7bf0efcf6f0e5f904c20471ab865cb912e40) - Fix official datasource tools to preserve complete responses and write returned result files.

- [#124](https://github.com/PythoughtsAI/pythinker-code/pull/124) [`3e72f25`](https://github.com/PythoughtsAI/pythinker-code/commit/3e72f25ad93dac02456ebb1e29d80cf904258c14) - Fix migration mapping the legacy `default_yolo` key to the dead `yolo` field instead of `default_permission_mode`.

- [#164](https://github.com/PythoughtsAI/pythinker-code/pull/164) [`0a76658`](https://github.com/PythoughtsAI/pythinker-code/commit/0a766584cba68b2e906a5528c286a8481bd47ed3) - Clarify plugin manager keyboard shortcuts and show plugin state changes inline.

- [#142](https://github.com/PythoughtsAI/pythinker-code/pull/142) [`dad2b87`](https://github.com/PythoughtsAI/pythinker-code/commit/dad2b87ceeb054204027709751f72baadf04b708) - Refactor TUI code structure.

- [#166](https://github.com/PythoughtsAI/pythinker-code/pull/166) [`92e1d8c`](https://github.com/PythoughtsAI/pythinker-code/commit/92e1d8c72bfb1ab31a46608120670698bbf582b8) - Report discovered plugin skills in plugin manager summaries.

- [#139](https://github.com/PythoughtsAI/pythinker-code/pull/139) [`50251a1`](https://github.com/PythoughtsAI/pythinker-code/commit/50251a136093c27c0d69a730b267b746dea47468) - Show file content and diff in Write and Edit approval prompts, and open them in a dedicated full-screen viewer on ctrl+e instead of expanding inline.

- [#117](https://github.com/PythoughtsAI/pythinker-code/pull/117) [`a6d379b`](https://github.com/PythoughtsAI/pythinker-code/commit/a6d379b2ceea4bf988517bdf357d1931a1fb1f05) - Offload large base64 media payloads from wire.jsonl into external blob files to reduce wire size and memory pressure during session replay. Includes an in-memory read-through cache on `BlobStore` so repeated rehydration avoids redundant disk reads.

- [#150](https://github.com/PythoughtsAI/pythinker-code/pull/150) [`8b5a251`](https://github.com/PythoughtsAI/pythinker-code/commit/8b5a25161ceac02894d1a09c78a5aa883e460c8e) - Wrap long question, body, and option text in the AskUserQuestion dialog instead of truncating with an ellipsis. The question prompt, body description, option label, option description, and submit-tab review entries now flow onto multiple lines with a hanging indent.

## 0.4.0

### Minor Changes

- [#116](https://github.com/PythoughtsAI/pythinker-code/pull/116) [`2c7a8cc`](https://github.com/PythoughtsAI/pythinker-code/commit/2c7a8cc010a7b8134c5f16185e031a6de4585165) - Expand folded paste markers on second paste. When the cursor is on a paste marker (e.g. `[paste [#1](https://github.com/PythoughtsAI/pythinker-code/issues/1) +15 lines]`) and the user pastes again, the marker expands back to the original content instead of inserting new clipboard data.

- [#26](https://github.com/PythoughtsAI/pythinker-code/pull/26) [`2b74025`](https://github.com/PythoughtsAI/pythinker-code/commit/2b74025302be9b42e68a15f33333c55d64a6c9e7) - Rework tool permissions: reads outside cwd no longer prompt, session approvals match the exact call, and path-based rules are case-insensitive.

- [#119](https://github.com/PythoughtsAI/pythinker-code/pull/119) [`ebf6e81`](https://github.com/PythoughtsAI/pythinker-code/commit/ebf6e8181ea20a0fcf6a609195ccf5b6cc2a665a) - Add user-global plugin installation, interactive plugin management, plugin-provided skills, and plugin-owned MCP servers.

- [#112](https://github.com/PythoughtsAI/pythinker-code/pull/112) [`d03f6f4`](https://github.com/PythoughtsAI/pythinker-code/commit/d03f6f4fa582314a4330d0049fed6a0baae7271a) - Add `/export-debug-zip` slash command to export the current session as a debug ZIP archive directly from the TUI.

- [#113](https://github.com/PythoughtsAI/pythinker-code/pull/113) [`028d069`](https://github.com/PythoughtsAI/pythinker-code/commit/028d069b12d8377c5c307b94f11f02233d9c0a26) - Add `/export-md` slash command to export the current session as a Markdown file.

### Patch Changes

- [#105](https://github.com/PythoughtsAI/pythinker-code/pull/105) [`d599183`](https://github.com/PythoughtsAI/pythinker-code/commit/d599183c8eccea813d7aa5ddd974e72139cbb63c) - Enhance `pythinker export` to include more diagnostic information in the manifest.

- [#89](https://github.com/PythoughtsAI/pythinker-code/pull/89) [`61cae59`](https://github.com/PythoughtsAI/pythinker-code/commit/61cae592fac0f1d824ee28263375937452f719ff) - Prevent the TUI from crashing when pull request lookup fails during startup.

- [#97](https://github.com/PythoughtsAI/pythinker-code/pull/97) [`2e8c417`](https://github.com/PythoughtsAI/pythinker-code/commit/2e8c417818bb68a71789e4966f18c2be6d39d835) - Fix thinking spinner leaking past turn end when an empty thinking delta creates an orphaned thinking component.

- [#103](https://github.com/PythoughtsAI/pythinker-code/pull/103) [`73c4232`](https://github.com/PythoughtsAI/pythinker-code/commit/73c4232e711c8e7c701d21a07c7b6aace3476360) - Show the original session resume command after forking a session.

- [#88](https://github.com/PythoughtsAI/pythinker-code/pull/88) [`ce420bf`](https://github.com/PythoughtsAI/pythinker-code/commit/ce420bf1c6825080d4c7ec9e155f96039d3376e7) - Refactor TUI resume replay logic.

- [#119](https://github.com/PythoughtsAI/pythinker-code/pull/119) [`ebf6e81`](https://github.com/PythoughtsAI/pythinker-code/commit/ebf6e8181ea20a0fcf6a609195ccf5b6cc2a665a) - Restrict plugin zip installs to manifests at the archive root or a single wrapper directory.

- [#102](https://github.com/PythoughtsAI/pythinker-code/pull/102) [`6f55f1d`](https://github.com/PythoughtsAI/pythinker-code/commit/6f55f1d0aff12ce13cea616a1f37e6242beb2ff8) - Route session-tagged log entries exclusively to the session sink instead of duplicating them to the global sink. Consistently omit stable main-agent context keys from all session log lines that carry `agentId=main`.

- [#92](https://github.com/PythoughtsAI/pythinker-code/pull/92) [`4e458d6`](https://github.com/PythoughtsAI/pythinker-code/commit/4e458d63643a56a2fb1ba9f908c774e56eef1c75) - Use one retry classification for transient LLM failures across regular turns and compaction.

## 0.3.0

### Minor Changes

- [#76](https://github.com/PythoughtsAI/pythinker-code/pull/76) [`6f22ae4`](https://github.com/PythoughtsAI/pythinker-code/commit/6f22ae48f84a062a65dcaa9510ffe96f40ab503b) - /logout now opens a picker so you can choose which provider to log out of, instead of always logging out the one tied to the current model. The current provider is highlighted by default, so pressing Enter matches the previous behavior. The command is also available as /disconnect.

### Patch Changes

- [#62](https://github.com/PythoughtsAI/pythinker-code/pull/62) [`e2b2b46`](https://github.com/PythoughtsAI/pythinker-code/commit/e2b2b46fc9c1d6a0ada67c590b8aa56e77c9c513) - Make `AgentRecords` hold the `Agent` instance directly and inline the restore dispatch logic.

- [#73](https://github.com/PythoughtsAI/pythinker-code/pull/73) [`bddc60f`](https://github.com/PythoughtsAI/pythinker-code/commit/bddc60f0e9af44d326dc0759a60bce93187f8a7b) - Prevent running the `/model` and `/sessions` slash commands while streaming or compacting context.

- [#70](https://github.com/PythoughtsAI/pythinker-code/pull/70) [`d95b013`](https://github.com/PythoughtsAI/pythinker-code/commit/d95b01342a7921f0863ceb37abad7984d0245509) - Preserve catalog-declared interleaved reasoning fields for OpenAI-compatible models configured through `/connect`.

- [#78](https://github.com/PythoughtsAI/pythinker-code/pull/78) [`61f7d0e`](https://github.com/PythoughtsAI/pythinker-code/commit/61f7d0e7a2b9933bdbe7eef9177e67e7386154a2) - Make OpenAI-compatible reasoner models work out of the box for hand-written provider configs. The `openai` provider now auto-detects thinking on incoming responses by scanning the de facto field set (`reasoning_content`, `reasoning_details`, `reasoning`), serializes thinking back as `reasoning_content` by default, and auto-injects `reasoning_effort` whenever the conversation history contains prior thinking — so DeepSeek, Qwen, One API and other gateway-fronted services no longer require a hand-set `reasoning_key`. The `reasoning_key` model-alias field remains available as an explicit override for non-standard gateways.

- [#66](https://github.com/PythoughtsAI/pythinker-code/pull/66) [`8ddfc04`](https://github.com/PythoughtsAI/pythinker-code/commit/8ddfc0433e3a3a51f326116607d28b0f409e7d93) - Fix API key input dialog showing a masked dot in empty state.

- [#72](https://github.com/PythoughtsAI/pythinker-code/pull/72) [`0ce0072`](https://github.com/PythoughtsAI/pythinker-code/commit/0ce0072cb44ea2bd3a7ca9c54d141c150f0bbb77) - Fix user skills in ~/.agents/ not being loaded.

- [#86](https://github.com/PythoughtsAI/pythinker-code/pull/86) [`5e354d0`](https://github.com/PythoughtsAI/pythinker-code/commit/5e354d0cc89816228d08c3ded17e75201fb300de) - Restore real-time token display for running subagents in the TUI.

- [#57](https://github.com/PythoughtsAI/pythinker-code/pull/57) [`8fb61f9`](https://github.com/PythoughtsAI/pythinker-code/commit/8fb61f9a3ead02bbd79f3a5ab605aba26e1cb847) - Hide the todo panel on resume when all todos are already completed.

- [#83](https://github.com/PythoughtsAI/pythinker-code/pull/83) [`7d9216d`](https://github.com/PythoughtsAI/pythinker-code/commit/7d9216d5aa1e96734c46c8d5d810ec7ed27b2275) - Always emit a paired tool result when a tool returns a malformed or missing result, preventing the next request from failing with a missing tool_call_id error.

- [#81](https://github.com/PythoughtsAI/pythinker-code/pull/81) [`1fbefc9`](https://github.com/PythoughtsAI/pythinker-code/commit/1fbefc99398d4a8ebebb377ff7ca2846483d1a9a) - Improve the Write tool UX.

- [#79](https://github.com/PythoughtsAI/pythinker-code/pull/79) [`5a90b53`](https://github.com/PythoughtsAI/pythinker-code/commit/5a90b53b045099ecb582a36d546e90a3978f0a75) - Fix Plan mode session resets so new sessions no longer fail after plan review rejection and continue receiving events after setup errors.

- [#77](https://github.com/PythoughtsAI/pythinker-code/pull/77) [`fe60c21`](https://github.com/PythoughtsAI/pythinker-code/commit/fe60c215be8979f6abc8258e5255c66dd73d5a19) - Exit promptly when the controlling terminal goes away. The TUI now handles `SIGHUP` / `SIGTERM` and stdout/stderr `EIO` / `EPIPE` / `ENOTCONN` errors, preventing leftover `pythinker` processes that pin a CPU core after the parent shell or multiplexer dies unexpectedly.

- [#85](https://github.com/PythoughtsAI/pythinker-code/pull/85) [`2bb50a3`](https://github.com/PythoughtsAI/pythinker-code/commit/2bb50a38d8379e2fac57547b1a563722f713c8fd) - Avoid overly small local completion caps that can truncate reasoning before summaries are produced.

## 0.2.0

### Minor Changes

- [#30](https://github.com/PythoughtsAI/pythinker-code/pull/30) [`a200a29`](https://github.com/PythoughtsAI/pythinker-code/commit/a200a297ac8986ec4baa8d2cdc881ef71bc3abfc) - Add a `/connect` command that configures a provider and model from a model catalog.

- [#30](https://github.com/PythoughtsAI/pythinker-code/pull/30) [`a200a29`](https://github.com/PythoughtsAI/pythinker-code/commit/a200a297ac8986ec4baa8d2cdc881ef71bc3abfc) - The `/connect` provider and model pickers now support type-to-search filtering, and long lists are paginated. The `/model` picker is also paginated when many models are configured.

- [#25](https://github.com/PythoughtsAI/pythinker-code/pull/25) [`c4dd1c7`](https://github.com/PythoughtsAI/pythinker-code/commit/c4dd1c7ff298290ee17d4a6676f93284621f32e8) - Flatten tool call data by inlining tool names and arguments at the top level, and limit legacy record migration so it only rewrites matching tool call payloads.

### Patch Changes

- [#9](https://github.com/PythoughtsAI/pythinker-code/pull/9) [`e503e69`](https://github.com/PythoughtsAI/pythinker-code/commit/e503e6963ab6cc6b4ed98c89389dbbb525fc6e9e) - Add `Ctrl-J` as an additional shortcut for inserting new lines in the TUI prompt.

- [#22](https://github.com/PythoughtsAI/pythinker-code/pull/22) [`2004aed`](https://github.com/PythoughtsAI/pythinker-code/commit/2004aedfe1d4e5e17762108bf48b7b9aa6d4e25b) - Add wire record migration handling during session replay.

- [#33](https://github.com/PythoughtsAI/pythinker-code/pull/33) [`ab4bd09`](https://github.com/PythoughtsAI/pythinker-code/commit/ab4bd090825cffbd7ab656b47840b0060d6cf601) - Report the macOS product version in OAuth device information instead of the Darwin kernel version.

- [#52](https://github.com/PythoughtsAI/pythinker-code/pull/52) [`064343a`](https://github.com/PythoughtsAI/pythinker-code/commit/064343a6e565a525fbf38b3a1f70f7ff0235a5ed) - Correct the `X-Msh-Platform` header value to `pythinker_code_cli`.

- [#38](https://github.com/PythoughtsAI/pythinker-code/pull/38) [`e9e4a48`](https://github.com/PythoughtsAI/pythinker-code/commit/e9e4a48633f2d216672e8905b0235107b5cbe34a) - Clarify the prompt-mode error when no model is configured by pointing users to the login flow.

- [#13](https://github.com/PythoughtsAI/pythinker-code/pull/13) [`35726d7`](https://github.com/PythoughtsAI/pythinker-code/commit/35726d7a41d54a0e6cb19a21d16980fd462132e1) - Hide the empty current session from the sessions picker while keeping other empty sessions visible.

- [#31](https://github.com/PythoughtsAI/pythinker-code/pull/31) [`475ebad`](https://github.com/PythoughtsAI/pythinker-code/commit/475ebadc2070e3b878789f6a89ce191b1bd957a9) - Stop mentioning OAuth credentials in the migration UI — they are never migrated, so the previous "needs /login" notice misread as a failure. OAuth-only installs no longer trigger the migration screen.

- [#31](https://github.com/PythoughtsAI/pythinker-code/pull/31) [`475ebad`](https://github.com/PythoughtsAI/pythinker-code/commit/475ebadc2070e3b878789f6a89ce191b1bd957a9) - Migrate user skills from `~/.pythinker/skills/` to `~/.pythinker-code/skills/` during the first-launch migration; existing target skills are kept.

- [#30](https://github.com/PythoughtsAI/pythinker-code/pull/30) [`a200a29`](https://github.com/PythoughtsAI/pythinker-code/commit/a200a297ac8986ec4baa8d2cdc881ef71bc3abfc) - When no models are configured, `/model` and the welcome panel now point users to `/login` (for Pythinker) and `/connect` (for other providers).

- [#11](https://github.com/PythoughtsAI/pythinker-code/pull/11) [`15b018f`](https://github.com/PythoughtsAI/pythinker-code/commit/15b018fc84a36a9ebde598970e5b44bebe5d68c6) - Surface API-provided error messages during feedback, usage, login, and model setup failures.

- [#24](https://github.com/PythoughtsAI/pythinker-code/pull/24) [`7858821`](https://github.com/PythoughtsAI/pythinker-code/commit/7858821f2f1fecc9de666780fc62434ca76dcc82) - Persist model selections from the terminal UI to the default configuration, and honor the configured default thinking state for new sessions.

- [#14](https://github.com/PythoughtsAI/pythinker-code/pull/14) [`0da6073`](https://github.com/PythoughtsAI/pythinker-code/commit/0da60730b9716c39a07e8a3a0a320e3af7ad30fa) - Move wire metadata handling into the record layer and keep persistence backends limited to storage operations.

- [#12](https://github.com/PythoughtsAI/pythinker-code/pull/12) [`89ea895`](https://github.com/PythoughtsAI/pythinker-code/commit/89ea8959eb9419d04e63645b4d89ca0e33f20d98) - Retry compaction responses that do not contain a summary before updating conversation history.

- [#29](https://github.com/PythoughtsAI/pythinker-code/pull/29) [`df7a9ca`](https://github.com/PythoughtsAI/pythinker-code/commit/df7a9cab606e0f152bc45b1d1645d76210b1e0c4) - Avoid CPU spikes from large streamed tool arguments and coalesce high-frequency streaming UI updates.

- [#47](https://github.com/PythoughtsAI/pythinker-code/pull/47) [`07ed2cf`](https://github.com/PythoughtsAI/pythinker-code/commit/07ed2cf9d4f01985c00c004b3bc0cc8d2587044b) - Emit session resume hint as a structured meta message in stream-json output format.

- [#49](https://github.com/PythoughtsAI/pythinker-code/pull/49) [`cf2227e`](https://github.com/PythoughtsAI/pythinker-code/commit/cf2227e8a5222ad9bd1167b573b62599d0efd906) - Resume sessions with a newer wire protocol version instead of failing. A warning is now shown in the TUI and records are replayed without migration.

- [#18](https://github.com/PythoughtsAI/pythinker-code/pull/18) [`a964bd2`](https://github.com/PythoughtsAI/pythinker-code/commit/a964bd2430a583ff0364fde19eafabda03b489ed) - Warn tmux users when extended key settings may prevent modified Enter shortcuts from working.

- [#17](https://github.com/PythoughtsAI/pythinker-code/pull/17) [`bfbd522`](https://github.com/PythoughtsAI/pythinker-code/commit/bfbd522a7160e597d673550f09fd4af089bfde34) - Let Pythinker requests use the remaining context window for completion tokens by default while keeping explicit environment limits as hard caps.
