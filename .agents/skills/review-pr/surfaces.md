# Populations and surfaces

Repository-specific inventory for the `review-pr` regression pass: who depends on existing
behavior, and what a diff must touch before behaviors have to be enumerated. It goes stale; add a
line after every regression post-mortem (see `SKILL.md`, "Retrospective backfill").

## 1. Populations: who depends on existing behavior

### Clients and entrypoints

| Population | Notes | Contract location |
|---|---|---|
| TUI users | `pythinker` default entrypoint | `apps/pythinker-code/src/tui/` |
| print-mode users | `pythinker "<prompt>"` headless runs, including scripts that parse `--output-format stream-json` output. Script parsers are a second-class population, but output-format changes must still be named in the changeset | `apps/pythinker-code/src/cli/` |
| desktop and web users | Both apps live in this repository (`apps/desktop`, `apps/pythinker-web`, shipped as the `apps/pythinker-code/dist-web` bundle) and consume the server's `/api/v1` REST and `/api/v1/ws`. A server-contract change must name the consumer apps and confirm their shipped clients against the previous release | `packages/agent-gateway/src/routes/`, `packages/agent-gateway/src/transport/ws/`, `docs/reference/server-api.md` |
| inspector users | `apps/pythinker-inspect` consumes the `/api/v1/debug` reflection RPC surface (loopback bind, bearer auth) | `packages/agent-gateway/src/transport/registerDebugRoutes.ts` |
| VS Code extension users | SDK event adapter; the webview has its own rendering contract | `apps/vscode/` |
| ACP client users | Zed and others, `pythinker acp`. stdio MCP is ACP's default transport and clients send it unconditionally; the capability matrix is a public promise | `packages/acp-server/`, `docs/reference/pythinker-acp.md` |
| SDK callers | `@pymodel/pythinker-code-sdk` export surface; provider implementations live behind kosong, which the CLI and the server also use | `packages/node-sdk/src/index.ts`, the `exports` map in `packages/node-sdk/package.json`, `packages/kosong/src/providers/` |
| remote-control users | `pythinker web --remote-control`; credential slot and relay follow the machine registration, behind a machine-wide single-instance lock | `packages/remote-control/` |

### Provider dialects

| Population | Notes |
|---|---|
| Official OAuth login | Default path; region handling |
| `openai` Chat Completions-compatible gateways | The messiest group: relay services, OpenRouter-shaped responses (`reasoning` string alongside a `reasoning_details` array), senders that only emit `reasoning_content`, strict history-message validation, third-party model `anyOf` handling |
| `anthropic`, `openai_responses`, `google-genai`, `vertexai` | Each with its own thinking, tool-call, and usage field shapes |
| Custom model configs | `api_key_env`, catalog imports, manually configured thinking parameters, `[secondary_model]` and the subagent model pool |

Code location: `packages/agent-core-v2/src/human/llm/requester/bases/`.

### Platforms and environments

| Population | Known sensitivities |
|---|---|
| Windows | Deep paths and recursive watch pressure, drive roots and UNC paths, IME composition input, CSI-u keyboard sequences |
| Linux | Filesystems without hardlinks, root directories with huge file counts |
| macOS | The default development environment, most easily mistaken for "all users" |
| Network proxies | Background subagent retries |
| native binary vs npm install | Different startup paths and update mechanisms |
| install channels | npm package, per-platform native binaries, VS Code marketplace package, bundled web assets — all decided by release and packaging workflows; a platform can break without a single `src/` line changing |

### Git repository shapes

| Population | Known sensitivities | Contract location |
|---|---|---|
| users starting inside submodules or worktrees | `core.worktree` is set; with symlinked paths (macOS `/tmp`, a linked home, Windows mapped drives) realpath and literal paths disagree. A background git probe that fails here can silence the whole footer | `packages/agent-core-v2/src/app/git/gitService.ts` |
| git-lfs and git-crypt users | Filter drivers in `.git/config` carry `required = true`; any hardening that clears filter commands turns `git status` fatal on modified filtered files unless `required` is cleared too | same |
| large-repository users | Depend on `core.fsmonitor`; the footer's background git has a timeout budget and silently treats a timeout as clean | `packages/agent-core-v2/src/app/git/` |
| repositories requiring signed commits or hooks | Any automatic commit path (Tower) that disables hooks or signing changes the commit outcome | `packages/agent-core-v2/src/features/tower/` |

### Configuration states

| Population | Notes | Contract location |
|---|---|---|
| default-config users | Any default flip is a behavior change for them | `packages/agent-core-v2/docs/config-manifest.toml` |
| experimental-flag users | `[experimental]` config and `PYTHINKER_CODE_EXPERIMENTAL_*` env; flags are declared per domain via `registerFlagDefinition`; flipping a flag's `default` to true is a release to everyone | `packages/agent-core-v2/src/**/flag.ts` |
| legacy-flag users | `PYTHINKER_CODE_LEGACY_FLAG`; in the past the TUI and print mode silently ignored it | |
| custom-agent users | `--agent` policies such as `disallowedTools` | |
| users with hooks configured | Event names and payloads are a contract with external scripts; past regressions include the approval panel not rendering and calls being silently approved | `packages/agent-core-v2/src/features/externalHooks/`, `docs/customization/hooks.md` |
| skills, plugins, and MCP users | stdio MCP, user-level skill roots, `[watch]` hot reload (flipping it off also silences AGENTS.md change nudges; `/reload` covers only config and skills) | `docs/customization/` |
| environment-variable users | The same variable must behave identically across the TUI, print mode, and the server entrypoints | `docs/configuration/env-vars.md` |
| theme, keybinding, and TUI-mode customizers | `docs/customization/themes.md`, `docs/reference/keyboard.md` | |

### Data eras

| Population | Notes | Contract location |
|---|---|---|
| sessions written by older versions | Wire logs, turn numbering, compacted transcripts; whether new versions read them and whether a rollback still reads them | `packages/agent-core-v2/docs/wire-manifest.d.ts`, `packages/agent-core-v2/docs/state-manifest.d.ts` |
| migrated sessions | Imports from older data roots | `packages/migration-legacy/` |
| the search index | minidb snapshot and WAL | `packages/minidb/` |
| background tasks and cron persistence | Recovery after abnormal exit | |
| directory layout | Anything reading or writing `~/.pythinker-code/` | `docs/configuration/data-locations.md` |

### External automation

| Population | Contract |
|---|---|
| scripts parsing `stream-json` | Event shapes and ordering |
| hook scripts | Event names, payload fields, return-value semantics |
| export consumers | Export format |
| users with telemetry disabled | Opt-out honored on every entrypoint |

### Model-behavior populations

Prompt text changes affect all users, and no test can prove "no impact". Populations known to
depend on specific sentences: users depending on "do not touch files outside the working
directory"; users depending on "cwd is the project root"; plan-mode reminder cadence; Tower
session titles and fencing behavior.

Prompt changes driven by external benchmark analysis trade one population's gain for another
population's loss; a PR must name both.

## 2. Trigger clues: diff hits that force a behavior enumeration

| Diff shows | Surface | Required check |
|---|---|---|
| `packages/agent-core-v2/src/app/agentProfileCatalog/system.md`, and any `packages/agent-core-v2/src/**/*.md` (tool descriptions, reminders, overlays, built-in skills) | model behavior | every deleted or edited sentence gets its own row: what the sentence enforced before, who depended on it, what enforces it now |
| `packages/agent-core-v2/docs/config-manifest.toml` (generated from `src/app/config/configSectionContributions.ts`, sync guarded by `test/app/config/configManifest.test.ts`) | config keys, defaults, validation | default flips and validation tightenings must be listed; changing the manifest without `docs/configuration/config-files.md` is stale docs |
| `packages/agent-core-v2/src/**/flag.ts` | experimental flags | a `default` flip to true is a release to everyone; treat as a behavior change |
| `packages/agent-core-v2/src/human/utils/watch.ts`, and any module-level default constant or `?? true` / `?? false` fallback that a config key overrides | default sources | flips must be listed; the config-path escape hatch needs a guard test, not only env; check the hatch does not depend on ConfigService being constructed before its consumers |
| `packages/agent-core-v2/docs/wire-manifest.d.ts`, `packages/agent-core-v2/docs/state-manifest.d.ts` | on-disk session format | can old sessions still be read, can the previous release read new data, is there a migration |
| `packages/agent-gateway/test/__snapshots__/apiSurface.snapshot.test.ts.snap`, `packages/agent-gateway/src/routes/`, `packages/agent-gateway/src/transport/ws/` | the server contract consumed by desktop, web, and the inspector | name the in-repo consumer apps; check whether previous-release clients still work against the new server |
| `packages/node-sdk/src/index.ts`, `packages/node-sdk/package.json` | SDK export surface | removals or signature changes are breaking |
| `packages/klient/src/` | the client facade under the SDK and ACP | a klient-only PR does not touch the SDK export surface; check behavior for SDK callers and ACP clients |
| `packages/transcript/src/contract/` | the transcript payload contract the server sends desktop, web, and VS Code | name the consumer apps; can previous-release clients parse the new payload |
| `.github/workflows/release.yml` and the native, vscode, and packaging workflows, `apps/pythinker-code/scripts/native/`, `apps/pythinker-code/scripts/check-web-assets.mjs` | release artifacts | check per install channel and platform: npm package contents, native binaries, marketplace package, bundled web assets still complete |
| `packages/acp-server/` | ACP clients | check each item of the capability matrix in `docs/reference/pythinker-acp.md` |
| `apps/pythinker-code/src/cli/` | CLI arguments, subcommands, `--output-format` | check against `docs/reference/pythinker-command.md` |
| `packages/agent-core-v2/src/features/externalHooks/` | hook events and payloads | check against `docs/customization/hooks.md` |
| `packages/agent-core-v2/src/human/llm/requester/bases/` | provider dialect branches | enumerate which provider payload shape takes which branch before and after, especially gateways that send multiple forms of a field |
| `packages/agent-core-v2/src/app/git/` | background git invocation, config overrides, timeouts | walk the git-shape populations row by row: does a failed probe silence all background git; do overridden config keys include ones that turn "disabled" into "failing" (`required`, `gpgSign`, `hooksPath`); are Windows cases skipped |
| `packages/migration-legacy/`, `packages/minidb/`, anything reading or writing the `~/.pythinker-code/` layout | data eras | is old data still readable and migratable |
| any added, removed, or re-semanticized environment-variable read, in any spelling (`process.env.X`, `process.env['X']`, dynamic keys, helpers) and any prefix | environment variables | check every entry in `docs/configuration/env-vars.md`; consistency across the TUI, print mode, and server entrypoints |
| `packages/agent-core-v2/src/app/scopes.ts`, config-ready and feature-assembly ordering | startup order and lifecycle | who depended on the old order |
| `docs/**` reference, configuration, and customization pages | public promises | behavior changed without docs, or docs changed without behavior, must be flagged either way |
| tests that rewrite an old assertion to the new behavior | direct evidence of a behavior change | map each to an inventory row |

## 3. History: calibration for levels

| Class | Case in this repository | What was missed | Level in hindsight |
|---|---|---|---|
| Default flip | the watch hot-reload default: a changeset named only the new default, not that editing config, skills, or AGENTS.md mid-session stopped applying and AGENTS.md change nudges went silent; the restore landed in #336 | the changeset never named the lost behavior; the config-path escape hatch had no guard test | L1 with an escape hatch, but a changed file having no effect with no signal is silent: effectively L2 |
| Safety tightening rolled back | the trust-boundary hardening batch: git probe and filter-driver hardening broke submodule and symlinked repository shapes and filtered-file status; reverted in #335 after review listed the broken populations; the local write-guard survived the revert | the landed review had not enumerated the git-shape populations up front | L3 candidates with no escape hatch; the population list is what caught it |
| Dialect branch narrowed | gateways exist that send both the string and the array form of a dual-shaped field; a parser that prefers the array stops reading the string, and the PR only said "the string is read when the array is absent" | nobody asked who sends both forms | L2 with no way back; the silently dropped input raises it to L3 for openai-compatible gateways |
| Refactor dropped a feature | a replaced path lost something the old path had: an env var, a fallback, an accepted input, a hook, a legacy flag; nobody inventoried the old path | the old path's feature list was never written down | L2 with no way back; silently ignored config raises to L3 |
| Fix changed startup timing | deferred assembly changed construction order; reverted within the day | nobody asked who depended on the old order | all users |
| Silent approval | with hooks configured, an approval surface stopped rendering and pending calls were approved silently | the hook-configured population was not in scope | L3, security boundary |
| Prompt sentence deleted | "no test references the sentence" was treated as evidence of no impact | the population receiving the prompt was never named | L2, no way back, all users; the change was openly visible, so not silent |
