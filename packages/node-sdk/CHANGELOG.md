# @pythoughts/pythinker-code-sdk

## 0.10.0

### Minor Changes

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add provider-native Fast mode controls for supported OpenAI and Anthropic models.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add validated session and persistent workspace directories with SDK, CLI, and TUI management.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose the precedence-resolved agent profile catalog through the SDK and a searchable TUI command.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add Anthropic Claude Code marketplace browsing and installation with searchable source selection and install-definition support.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add catalog-backed provider connections with interactive or environment-referenced credentials, live model discovery, provider-aware model selection, and model-specific thinking controls.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose files loaded by Read through the SDK and a `/files` TUI command.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose the model-visible context breakdown through the SDK and a `/context` TUI report.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add persisted file checkpoints with preview and recovery-backed code or conversation rewind through the SDK, CLI, and TUI.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add live instruction refresh and a `/memory` command for user and project memory files.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add discoverable built-in, user, project, and plugin output styles with config-backed prompt injection and TUI selection.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add validated full configuration replacement to the SDK.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose parent tool-call identity on subagent lifecycle events.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add `/cost` to show accumulated session spend and current model token rates, with pricing data available through SDK session status.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose session metadata through the SDK and add searchable session tags with `/tag`.

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Add a read-only verification agent and request independent checks when multi-step task lists close without verification.
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

- [`6a834d3`](https://github.com/Pythoughts-labs/pythinker-code/commit/6a834d3d837834b5b4e07eb144be3138769e3b6a) - Expose bounded working-tree diffs through the SDK and a native `/diff` browser.

## 0.9.4

### Patch Changes

- [#838](https://github.com/PythoughtsAI/pythinker-code/pull/838) [`843a731`](https://github.com/PythoughtsAI/pythinker-code/commit/843a731097fc18b2e41ab0405b5fbcb6149ba55c) - Show the underlying connection error when OAuth token refresh fails after internal retries, instead of prompting for login. Token refresh failures are no longer re-retried at the agent loop level.

- [#625](https://github.com/PythoughtsAI/pythinker-code/pull/625) [`9a8fea5`](https://github.com/PythoughtsAI/pythinker-code/commit/9a8fea5c85177cd887896108c05ba9e174f28250) - Add host-side config helpers `loadRuntimeConfigSafe` and `resolveConfigPath` for inspecting config without spinning up a full PythinkerCore.

## 0.9.3

### Patch Changes

- [#689](https://github.com/PythoughtsAI/pythinker-code/pull/689) [`8d251f8`](https://github.com/PythoughtsAI/pythinker-code/commit/8d251f8ab44ead65f6c1bb264980ee7d075142ad) - Drop invalid config.toml sections with a warning instead of failing to start.

## 0.9.2

### Patch Changes

- [#648](https://github.com/PythoughtsAI/pythinker-code/pull/648) [`54302ad`](https://github.com/PythoughtsAI/pythinker-code/commit/54302ad612294056a47ada74b76737f2284861b5) - Prevent overlapping interactive agent requests from using the wrong active agent.

## 0.9.1

### Patch Changes

- [#591](https://github.com/PythoughtsAI/pythinker-code/pull/591) [`e48234a`](https://github.com/PythoughtsAI/pythinker-code/commit/e48234af576e41e630736450c66b690226707bc3) - Fix Windows builds and development launches that could fail when package binaries resolve to command shims.

## 0.9.0

### Minor Changes

- [#487](https://github.com/PythoughtsAI/pythinker-code/pull/487) [`4d11394`](https://github.com/PythoughtsAI/pythinker-code/commit/4d113949c8e906c20c7188817926f44786653923) - Honor the standard `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` environment variables, including SOCKS proxies, for all outbound traffic.

- [#424](https://github.com/PythoughtsAI/pythinker-code/pull/424) [`72c4b0a`](https://github.com/PythoughtsAI/pythinker-code/commit/72c4b0adaa6ae0466875cd8e4066c42456195f21) - Add the `/swarm` command for running agent swarms with live progress and rate-limit-aware retries.

### Patch Changes

- [#395](https://github.com/PythoughtsAI/pythinker-code/pull/395) [`879a7ee`](https://github.com/PythoughtsAI/pythinker-code/commit/879a7eeb33a8bedf18779d74a00d78369dae3db5) - Fix ACP slash skill routing, bootstrap context reads, file and permission edge cases, subagent event handling, and stale-file edit messaging.

- [#552](https://github.com/PythoughtsAI/pythinker-code/pull/552) [`db82e33`](https://github.com/PythoughtsAI/pythinker-code/commit/db82e33a20fd1ec204672df4ba5bc38800ce8dea) - Fix goal resume behavior by restoring goal state from agent records.

## 0.8.0

### Minor Changes

- [#420](https://github.com/PythoughtsAI/pythinker-code/pull/420) [`86a42a2`](https://github.com/PythoughtsAI/pythinker-code/commit/86a42a26a1e01f1748a937031fa76ebeaa1e28a8) - Add persistent experimental feature toggles and a TUI panel that applies confirmed changes by reloading the current session.

- [#383](https://github.com/PythoughtsAI/pythinker-code/pull/383) [`15d71b5`](https://github.com/PythoughtsAI/pythinker-code/commit/15d71b5130d949c35d9dc2641e807e08d72dce48) - Add /reload to reload the current session and apply updated config files, plus /reload-tui to reload only TUI preferences.

- [#431](https://github.com/PythoughtsAI/pythinker-code/pull/431) [`6a4e4c7`](https://github.com/PythoughtsAI/pythinker-code/commit/6a4e4c75d4bf6db3fefbb5c115d7a7c324bcae16) - Add a doctor command for validating Pythinker Code configuration files.

### Patch Changes

- [#399](https://github.com/PythoughtsAI/pythinker-code/pull/399) [`232ed87`](https://github.com/PythoughtsAI/pythinker-code/commit/232ed874d41de777e6ff9c539ac22d830d0b5c3a) - Keep managed OAuth credentials scoped to their configured authentication and API endpoints.

- [#430](https://github.com/PythoughtsAI/pythinker-code/pull/430) [`be0da5f`](https://github.com/PythoughtsAI/pythinker-code/commit/be0da5ff39641e117d60045a43a7d5d2e0b85b75) - Fail early when Git Bash is missing on Windows before starting CLI sessions.

## 0.7.0

### Minor Changes

- [#338](https://github.com/PythoughtsAI/pythinker-code/pull/338) [`ba7dd73`](https://github.com/PythoughtsAI/pythinker-code/commit/ba7dd736a3b295b2a29c229a944208c232d51458) - Add `/btw` for side-channel conversations without steering the active main turn.

- [#339](https://github.com/PythoughtsAI/pythinker-code/pull/339) [`a6b16ce`](https://github.com/PythoughtsAI/pythinker-code/commit/a6b16ce6b4bdc20ed33888975c7da7ff1919e22f) - Allow SDK runtime creation to use a separate RPC client while preserving local CLI startup.

## 0.6.0

### Minor Changes

- [#270](https://github.com/PythoughtsAI/pythinker-code/pull/270) [`ac37d74`](https://github.com/PythoughtsAI/pythinker-code/commit/ac37d7448458fdb73fbe00e35856dcf44a13f734) - Add experimental goal mode for longer tasks that need more than one turn. Turn it on with `PYTHINKER_CODE_EXPERIMENTAL_GOAL_COMMAND=1` before you start Pythinker.

  Use `/goal <objective>` in the TUI when you want Pythinker to keep working on one task across turns. For example:

  ```text
  /goal Fix the failing checkout test
  ```

  Pythinker shows the goal in the TUI and keeps progress visible while it works. Use `/goal status`, `/goal pause`, `/goal resume`, `/goal cancel`, and `/goal replace <objective>` to manage the goal. This feature is still experimental. Try it and tell us what would make it more useful.

- [#315](https://github.com/PythoughtsAI/pythinker-code/pull/315) [`191059d`](https://github.com/PythoughtsAI/pythinker-code/commit/191059d40049d3bfd07661ac03bb961eac1407f7) - Add background structured questions so agents can continue while waiting for user answers.

### Patch Changes

- [#145](https://github.com/PythoughtsAI/pythinker-code/pull/145) [`d912053`](https://github.com/PythoughtsAI/pythinker-code/commit/d912053b0d3983f4e67450c347616086cfbd1fe7) - Fix Git Bash path detection on Windows by also searching `usr\bin\bash.exe` locations, which is where bash lives in many Git for Windows installations where `bin\bash.exe` does not exist.

## 0.5.0

### Minor Changes

- [#204](https://github.com/PythoughtsAI/pythinker-code/pull/204) [`ee69d0a`](https://github.com/PythoughtsAI/pythinker-code/commit/ee69d0ac29f56bde4957c14767d7ca436697d9cf) - Render scheduled reminders distinctly in the TUI, expose cron fired events to SDK clients, and report cron fire times with local timezone offsets.

## 0.4.0

### Minor Changes

- [#221](https://github.com/PythoughtsAI/pythinker-code/pull/221) [`bab2da7`](https://github.com/PythoughtsAI/pythinker-code/commit/bab2da7b1c785d6deba25decb1411f8f5a70de8c) - Install plugins directly from GitHub repository URLs, and surface each install's origin and trust level (pythinker-official, curated, third-party) in the plugin manager.

- [#118](https://github.com/PythoughtsAI/pythinker-code/pull/118) [`8913440`](https://github.com/PythoughtsAI/pythinker-code/commit/891344054111a05171963cfa524ef749c2855321) - Support querying sessions by sessionId or workDir in listSessions, and show a helpful cd command when resuming a session from a different working directory.

### Patch Changes

- [#221](https://github.com/PythoughtsAI/pythinker-code/pull/221) [`bab2da7`](https://github.com/PythoughtsAI/pythinker-code/commit/bab2da7b1c785d6deba25decb1411f8f5a70de8c) - Restrict plugin trust badges to Pythinker-hosted plugin CDN URL patterns.

## 0.3.0

### Minor Changes

- [#119](https://github.com/PythoughtsAI/pythinker-code/pull/119) [`ebf6e81`](https://github.com/PythoughtsAI/pythinker-code/commit/ebf6e8181ea20a0fcf6a609195ccf5b6cc2a665a) - Add user-global plugin installation, interactive plugin management, plugin-provided skills, and plugin-owned MCP servers.

- [#113](https://github.com/PythoughtsAI/pythinker-code/pull/113) [`028d069`](https://github.com/PythoughtsAI/pythinker-code/commit/028d069b12d8377c5c307b94f11f02233d9c0a26) - Add `/export-md` slash command to export the current session as a Markdown file.

### Patch Changes

- [#105](https://github.com/PythoughtsAI/pythinker-code/pull/105) [`d599183`](https://github.com/PythoughtsAI/pythinker-code/commit/d599183c8eccea813d7aa5ddd974e72139cbb63c) - Enhance `pythinker export` to include more diagnostic information in the manifest.

## 0.2.1

### Patch Changes

- [#70](https://github.com/PythoughtsAI/pythinker-code/pull/70) [`d95b013`](https://github.com/PythoughtsAI/pythinker-code/commit/d95b01342a7921f0863ceb37abad7984d0245509) - Preserve catalog-declared interleaved reasoning fields for OpenAI-compatible models configured through `/connect`.

## 0.2.0

### Minor Changes

- [#30](https://github.com/PythoughtsAI/pythinker-code/pull/30) [`a200a29`](https://github.com/PythoughtsAI/pythinker-code/commit/a200a297ac8986ec4baa8d2cdc881ef71bc3abfc) - Add a `/connect` command that configures a provider and model from a model catalog.

### Patch Changes

- [#33](https://github.com/PythoughtsAI/pythinker-code/pull/33) [`ab4bd09`](https://github.com/PythoughtsAI/pythinker-code/commit/ab4bd090825cffbd7ab656b47840b0060d6cf601) - Report the macOS product version in OAuth device information instead of the Darwin kernel version.

- [#49](https://github.com/PythoughtsAI/pythinker-code/pull/49) [`cf2227e`](https://github.com/PythoughtsAI/pythinker-code/commit/cf2227e8a5222ad9bd1167b573b62599d0efd906) - Resume sessions with a newer wire protocol version instead of failing. A warning is now shown in the TUI and records are replayed without migration.
