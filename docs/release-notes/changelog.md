---
outline: 2
---

# Changelog

This page documents the changes in each Pythinker Code CLI release.

## 0.12.0 (2026-08-07)

### Features

- Show the plan before a Dynamic Workflow runs, and let a good one be saved as a command
- Let a Dynamic Workflow require structured output from its subagents. Passing `output_schema` makes each subagent return a validated object instead of free text, and a subagent that cannot satisfy the schema is reported separately from one that failed outright.
- Let a Dynamic Workflow run its subagents on a different model than the agent orchestrating them. `DynamicWorkflow` accepts `model` and `effort` for every subagent in the call, and `/workflow model <alias>` sets that model for the session so an expensive orchestrator can hand mechanical work to a cheaper or faster one.
- `pythinker login` now opens a provider picker instead of going straight to one provider, and accepts `--provider <id|name>` to skip it. The VS Code extension's sign-in offers the same providers, and both surfaces present the same thinking-effort levels for a given model.
- Let a release declare a minimum supported version, so a client below it is offered the update without waiting for its staged rollout batch.
- Add two ways to rein in Dynamic Workflow fan-out: `disableWorkflows` turns the tool off entirely, and `workflowSizeGuideline` sets an advisory ceiling that is mentioned to the model and warned about, on every surface, when a run exceeds it. Both are settable in config or by environment variable.
- Give every Dynamic Workflow run an id and stamp it on the subagent events it produces, so a client can tell which run a given subagent belongs to when several are in flight.

### Bug Fixes

- Stop offering updates to versions that were never published: the update channel now advertises only the release that is actually available for download.
- Stop offering an update with no build for the running platform, give every installer network call a timeout, expire a stale install lease instead of blocking updates forever, and say which version is installing and why a failed one stopped retrying.
- Survive two malformed inputs that used to end a run. A catalog entry that is not an object is now dropped when the catalog is read, instead of reaching the provider picker and throwing past the bundled-catalog fallback that was meant to save the login. A non-finite subagent concurrency limit now falls back to the default: `NaN` passed every clamp, and each free-slot test against it was false, so the batch launched nothing and never finished.
- Show the whole large-workflow warning in the editor extension. The line was truncated to the panel width, so in a narrow side panel the reader saw the opening words and no reason.
- Keep a subagent on the model and effort its profile assigns when the subagent is resumed or retried, instead of reverting it to the main agent's model.
- Show Dynamic Workflow member progress from the observed stage only, so a running subagent no longer sits at 99% for the rest of its run.
- Ignore empty entries in a Dynamic Workflow's item list instead of rejecting the call. A trailing empty item used to fail argument validation, which discarded the whole workflow before any subagent started and forced the agent to send every prompt again. The dropped count is now reported with the results, and the launch panel counts only the subagents that will actually run.
- Finish handling blank Dynamic Workflow items. A run that dropped one reported its results after a note explaining the drop, which made the whole result parse as unsupported and rendered a successful run as failed; the note now follows the results. A blank entry also no longer leaves a row queued forever with the header stuck below its total, and no longer pushes a full item list over the subagent cap and back into whole-call rejection.
- Let `/yolo` and `/auto` be used in the VS Code extension before the first message is sent — the request now applies to the session that chat opens next instead of failing with "Could not change the permission mode."
- Keep a Dynamic Workflow subagent's output schema when a provider rate limit forces its turn to be retried. The retried turn lost the schema, so the subagent answered in prose and the workflow reported it as completed rather than as a schema failure.
- Stop a Dynamic Workflow row that has not started from reading as stalled. A queued row measured its silence from the launch of the whole run, so a long queue turned every waiting row amber and then red while nothing was wrong. A queued row now shows the same placeholder a finished one does, and a suspended row keeps its count without the alarm colours, because only a running row can stall.
- Show a Dynamic Workflow's running rows with a spinning grey dot, so a working agent reads as motion rather than as a static dot the eye cannot tell from a finished one, and shimmer the Orchestrating label in periwinkle instead of grey.
- Refuse a device authorization whose verification URL is not HTTPS. Every surface hands that URL to the host's "open externally" API, so a provider answering with `file:`, `javascript:`, or an installed application's own scheme had the agent launch it. The check runs where the response is parsed, so the terminal, the TUI, and the editor extension are all covered.
- Keep the configured provider signed in when a login is abandoned. Backing out at the model picker, or a failure while fetching the model list, no longer clears the existing credentials, and dismissing the provider picker returns to the sign-in screen instead of reporting a failed login.
- Write the thinking effort picked at login to disk. The apply step recorded the level, but the patch that saved the result listed everything except it, so an API-key login still reopened at the default effort. Choosing `off` now also clears a level a previous login left behind, which a patch that only merges could not do by omitting the key.
- Save the thinking-effort level picked during login. Only an on/off flag was stored, so choosing low, medium, or xhigh reopened the session at high, and an OpenAI Codex login reopened at the model's maximum effort regardless of the choice.
- Accept a provider's plain id for `--provider` at login, so a catalog provider no longer has to be named by its full display name, and stop a cancelled OpenAI Codex sign-in from holding the process open for the rest of its two-minute callback timeout. In the editor extension, signing in now shows one cancellable progress notification, a repeated sign-in joins the one already running instead of opening a second set of prompts, and a completed sign-in is no longer reported as failed when the status refresh behind it fails.
- Offer a model's declared thinking-effort levels when signing in to OpenAI Codex. The picker previously fell back to low / medium / high regardless of what the model supports, disagreeing with the effort list recorded in the config it then wrote.

### Polish

- Bound subagent fan-out with hard caps: 128 subagents per call, 200 per session, and a nesting depth of 3. Nesting was previously unbounded, so a workflow that spawned workflows could grow without limit; past depth 3 the call now fails instead.
- Replace the Dynamic Workflow progress bar with the two things it can actually know: how many tool calls each agent has made, and how long it has been silent. The old bar pinned every tool-using agent at 75% until it finished, so an agent working hard and one wedged for ten minutes looked identical. A row that goes quiet now turns amber, then red.
- Show update availability and live download progress in the status row under the prompt, replacing the startup banner chip that was computed once and never refreshed.
- Rename the ACP authentication method to reflect that login is multi-provider: it now reads "Log in with a provider" and explains that the provider is chosen in a terminal. Clients matching the previous wording will need updating.
- Fix the Dynamic Workflow card showing `[object Object]`, phantom extra agent rows, and tool labels fused into streamed text when a workflow is called with object items.
- Brighten the periwinkle accent in the VS Code extension's dark theme so inline code in chat is easier to read.

### Refactors

- Make the login platform layer provider-neutral. Model listing, capability derivation and the on-disk config shape are now one set of types shared by every login path, instead of living in a provider-specific module that other providers imported from; the duplicate copies of the capability derivation and the model-info parser are collapsed into one.

## 0.9.2 (2026-08-05)

### Bug Fixes

- Let `/yolo` and `/auto` take effect in the VS Code extension while the agent is running, and auto-approve the requests already waiting on screen.

## 0.9.0 (2026-08-05)

### Features

- Resolve a workspace's skills without opening a session, so an editor panel can list them before its first message.

### Bug Fixes

- Stop the fixed-layout TUI anchoring its first frames to the shell cursor, which pushed the panel border into scrollback.

### Polish

- Rename the managed OAuth provider so it is named after the platform that serves it rather than reading as a first-party service: the provider id is now `managed:kimi-code`, its models are aliased `kimi-code/*`, and its credentials are stored under `oauth/kimi-code`.
- Add an SDK routine that imports a catalog provider and its models into the persisted config, and use it for the CLI provider import so both entry points preserve existing defaults the same way.

## 0.8.1 (2026-08-05)

### Bug Fixes

- Fix the native install script exiting immediately without installing anything when run the documented way, `curl -fsSL … | bash`, which also broke automatic background updates for native installs.
- Report why an automatic update failed instead of failing silently: the installer's error output is now recorded and shown on the next update prompt, native installs on macOS and Linux pin the version the rollout picked, and update messages tell you to open a new terminal to apply the update.

## 0.8.0 (2026-08-04)

### Features

- Enable automatic updates for native installs on Windows: /update now installs the new version in the background instead of printing a manual command, and the installer safely replaces the running executable.

### Bug Fixes

- Fix Kimi and Moonshot models rejecting every request with an invalid tool schema error when a tool declares `anyOf` alongside its own type or properties.

### Other

- Remove the Pythinker Datasource plugin from the marketplace; its data gateway backend is not available, so every datasource query failed.
- Improve performance and fix bugs.

## 0.7.0 (2026-08-04)

### Features

- Prepare verified Homebrew updates in the background and install them automatically on the next interactive launch.

### Bug Fixes

- Fix context compaction failing with provider "Invalid max_tokens" errors by capping requested completion tokens to the remaining context window and a safe output ceiling instead of the full context window size.
- Fix Dynamic Workflow progress sticking at 90% during long streaming, show a Finalizing state once all delegated agents finish, and fix member row alignment at narrow widths.

## 0.6.2 (2026-08-04)

### Polish

- Clear the terminal before the install script's animated intro so earlier shell output no longer interleaves with the logo animation.
- Restyle the browser OAuth sign-in confirmation pages for all providers to match the website's light design.

## 0.6.1 (2026-08-03)

### Bug Fixes

- Fix the CLI failing to start on Windows with "process.execve is unavailable" by using the spawn fallback instead of calling execve there.
- Prompt for an API key when connecting a catalog provider whose environment variable is not set, instead of failing with "Environment variable is not set or is empty". Applies to `/login`, `/provider`, and `pythinker provider catalog add`, which now also accepts `--api-key <key>`.
- Point the native install scripts at the published release assets.

### Polish

- Show a clear requirement message with the native-installer alternative when the CLI is launched on Node.js older than 26.4, instead of failing with a cryptic flag error.
- Explain in `/update` and the startup update notice that Homebrew installs do not auto-update, and point to the native installer for automatic background updates.

## 0.6.0 (2026-08-03)

### Other

- Maintenance release with internal improvements and dependency updates.
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

