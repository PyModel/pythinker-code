---
"@pythoughts/pythinker-code": minor
"@pythoughts/pythinker-code-sdk": minor
---

Add a read-only verification agent and request independent checks when multi-step task lists close without verification.
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
