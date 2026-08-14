# Changelog

## 0.9.1

### Patch Changes

- Updated dependencies [[`2b2f438`](https://github.com/PyModel/pythinker-code/commit/2b2f438acbdb1d5367b39c5e479fd72f6c46dec2)]:
  - @pymodel/pythinker-code-sdk@0.16.0

## 0.9.0

### Minor Changes

- [#48](https://github.com/PyModel/pythinker-code/pull/48) [`17967df`](https://github.com/PyModel/pythinker-code/commit/17967dffb7ca3ed6f23f9bc0346042fc8a1b2bf0) - Combine permission mode, plan mode, and thinking effort into one composer menu, and answer approval prompts with number keys.

- [#48](https://github.com/PyModel/pythinker-code/pull/48) [`17967df`](https://github.com/PyModel/pythinker-code/commit/17967dffb7ca3ed6f23f9bc0346042fc8a1b2bf0) - Add a config hub page that shows models, providers, MCP servers, the local config file, and extension settings in one place.

- [#48](https://github.com/PyModel/pythinker-code/pull/48) [`17967df`](https://github.com/PyModel/pythinker-code/commit/17967dffb7ca3ed6f23f9bc0346042fc8a1b2bf0) - The extension UI now follows the editor color theme, including light, dark, and high-contrast themes.

- [#48](https://github.com/PyModel/pythinker-code/pull/48) [`17967df`](https://github.com/PyModel/pythinker-code/commit/17967dffb7ca3ed6f23f9bc0346042fc8a1b2bf0) - Add a status bar indicator, quick-fix code actions, terminal and editor context menu entries, a getting-started walkthrough, and a new-conversation keybinding.

### Patch Changes

- [#48](https://github.com/PyModel/pythinker-code/pull/48) [`17967df`](https://github.com/PyModel/pythinker-code/commit/17967dffb7ca3ed6f23f9bc0346042fc8a1b2bf0) - Render long conversations with a virtualized list, fix control overlap at narrow sidebar widths, and make sign-out work from the command palette.

- Updated dependencies [[`c8cdcc7`](https://github.com/PyModel/pythinker-code/commit/c8cdcc78528f3fd8dedf9111ec0c91f3242e3012)]:
  - @pymodel/pythinker-code-sdk@0.15.0

## 0.8.8

### Patch Changes

- Updated dependencies [[`e534040`](https://github.com/PyModel/pythinker-code/commit/e534040c82d1e3b8c217e6e35ddcf248065ff950)]:
  - @pymodel/pythinker-code-sdk@0.14.0

## 0.8.7

### Patch Changes

- [#39](https://github.com/PyModel/pythinker-code/pull/39) [`acf57d1`](https://github.com/PyModel/pythinker-code/commit/acf57d197631ce90ef64cf0768bfc22009cda820) - Publish the VS Code extension to Open VSX by creating the publisher namespace first, so Cursor, VSCodium and Windsurf can install it, and report the registry's own error when a publish fails instead of only the CLI exit line.

## 0.8.6

### Patch Changes

- Updated dependencies [[`2ce6b5e`](https://github.com/PyModel/pythinker-code/commit/2ce6b5e66935335567a6525413ad8e77b84d852f)]:
  - @pymodel/pythinker-code-sdk@0.13.0

## 0.8.5

### Patch Changes

- Updated dependencies [[`42da384`](https://github.com/PyModel/pythinker-code/commit/42da384cb36d29ecf0cc147f753790e022e13709)]:
  - @pymodel/pythinker-code-sdk@0.12.0

## 0.8.4

### Patch Changes

- [#22](https://github.com/PyModel/pythinker-code/pull/22) [`45be822`](https://github.com/PyModel/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32) - Show the assistant logo beside replies without breaking the step timeline, complete a picked slash command in the input instead of sending it on its own, ship a decodable Marketplace icon, and retry transient registry failures when publishing.

- Updated dependencies [[`45be822`](https://github.com/PyModel/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32), [`45be822`](https://github.com/PyModel/pythinker-code/commit/45be8227077847f760fa7b6b09333cf5a8127f32)]:
  - @pymodel/pythinker-code-sdk@0.11.0

## 0.6.7

### Patch Changes

- [#2326](https://github.com/MoonshotAI/kimi-code/pull/2326) [`302b2cd`](https://github.com/MoonshotAI/kimi-code/commit/302b2cd680e0ec66f68b4572238de84ce311c5f4) Thanks [@gaoyuan1223m](https://github.com/gaoyuan1223m)! - Fix only the first question being answerable when the agent asked multiple questions at once; each question is now answered one by one and submitted together.

## 0.6.6

### Patch Changes

- [#2393](https://github.com/MoonshotAI/kimi-code/pull/2393) [`6d0a046`](https://github.com/MoonshotAI/kimi-code/commit/6d0a046488edda56219961b253c4787abae7a113) Thanks [@wbxl2000](https://github.com/wbxl2000)! - Fix new users getting stranded on "Model setup required" with no way back to sign-in when the first login finishes authorization but fails to complete model setup; the screen now offers a path back to the sign-in page so login can be retried.
- [#2402](https://github.com/MoonshotAI/kimi-code/pull/2402) [`0f3b106`](https://github.com/MoonshotAI/kimi-code/commit/0f3b106c4260ad626f66bc5c457a535d3163f2bc) Thanks [@wbxl2000](https://github.com/wbxl2000)! - Reword the sign-in waiting message from "Waiting for authorization" to "Waiting for authentication".

- Updated dependencies [[`40172c7`](https://github.com/MoonshotAI/kimi-code/commit/40172c7ca96ca981b043b793588dd32e898979fa)]:
  - @moonshot-ai/kimi-code-sdk@0.15.0

## 0.6.5

### Patch Changes

- [#1994](https://github.com/MoonshotAI/kimi-code/pull/1994) [`beeb964`](https://github.com/MoonshotAI/kimi-code/commit/beeb964393c8f9a38c2b1e2273e4415fc434b16d) Thanks [@RealKai42](https://github.com/RealKai42)! - Reduce webview streaming re-render churn: settled assistant messages no longer re-render on every streaming delta, and local images over 10MB are no longer inlined into the webview DOM.
- Updated dependencies [[`ec88d35`](https://github.com/MoonshotAI/kimi-code/commit/ec88d352e8f4dc5e8ffd1212f016138458f69893), [`b5efba7`](https://github.com/MoonshotAI/kimi-code/commit/b5efba7abcaf4041f81ec520097a61e6546e8c50), [`ce0e3ce`](https://github.com/MoonshotAI/kimi-code/commit/ce0e3ceb04223bdaad8e8931bad46eff561055b6), [`e458323`](https://github.com/MoonshotAI/kimi-code/commit/e45832398d0d9cad98dbad1cbf1e5b103a20aace)]:
  - @moonshot-ai/kimi-code-sdk@0.14.0

## 0.6.4

### Changed

- Picking a model's highest thinking effort now applies to the current session
  only instead of becoming the global default: the top tier saves just the
  on/off toggle, lower tiers persist as the default as before, and
  re-confirming the current effort no longer rewrites the saved preference.
  The model and thinking pickers also note that switching mid-conversation
  invalidates the existing prompt cache.
- Unified the YOLO and Auto permission mode naming and descriptions with the
  CLI (`/afk` is now `/auto`), and approval requests that fall outside the
  active permission mode (sensitive files, plan reviews, ask rules) are now
  always shown to you instead of being auto-approved.

## 0.6.3

### Fixed

- Editor mentions now work for files outside the working directory, and paths
  containing spaces are quoted correctly.
- Cancelling a running turn now reliably reaches the engine, and the UI no
  longer reports a task as stopped when there is nothing to cancel.
- Attaching to or resuming an existing session no longer overwrites its model
  and thinking effort with the configured defaults; model or effort changes
  picked in the composer are applied when the prompt is sent.

## 0.6.2

### Fixed

- A core error arriving in the middle of a turn no longer corrupts the active
  turn; the turn now ends cleanly with an error instead of leaving the chat in
  a broken state.
- Kimi sign-in and connection failures now include the underlying transport
  cause (for example DNS or connection refused) instead of a generic error.
- Closed several FetchURL SSRF bypasses and the DNS-rebinding window.
- Tool calls interrupted mid-stream are now recorded and closed, so they no
  longer corrupt the session history.

## 0.6.1

### Fixed

- The **Sign in** action in the settings (gear) menu now actually starts the
  Kimi login flow and shows an error toast when sign-in fails, instead of
  silently doing nothing.

## 0.6.0

### Breaking

- Raised the minimum supported editor version to VS Code 1.100.0.
- Legacy Kimi Code OAuth credentials and MCP OAuth credentials are deliberately
  not migrated. Sign in to Kimi Code again and re-authorize affected MCP
  servers after upgrading.
- Removed the `kimi.executablePath` and `kimi.environmentVariables` settings.
  The old `kimi.environmentVariables.KIMI_SHARE_DIR` value is consulted only to
  discover legacy data during migration; it is not applied to the new runtime.
  The system-level `KIMI_CODE_HOME` environment variable remains supported.

### Changed

- Replaced the legacy Python/stdio runtime with the in-process Kimi Code Node
  SDK. The extension no longer downloads or starts a separate Kimi executable.
- The in-process engine is the same one that powers the Kimi Code CLI, so the
  agent gains CLI-parity capabilities beyond the legacy runtime, including
  parallel subagent swarms, background tasks, and long-running goal runs.
- Added an opt-in legacy migration prompt on the first launch that detects data
  from version 0.5.x. The migration copies or merges supported data into the
  current Kimi Code home and does not delete the legacy source. If migration is
  skipped or needs to be retried, run **Kimi Code: Migrate Legacy Data** from the
  Command Palette.
- When VS Code and the Kimi Code terminal app resolve to the same
  `KIMI_CODE_HOME`, they use the same configuration and session storage. Running
  the same session concurrently from multiple processes is not supported or
  protected by cross-process locking.
- The model picker groups models by provider when multiple providers are
  configured, keeps provider identity when display names match, and recognizes
  adaptive-thinking metadata. A configured custom default provider no longer
  requires dismissing the Kimi account login screen on every launch.
- The file changes panel and Undo actions use extension-maintained baselines.
  Files changed through Kimi's Write and Edit operations are tracked on a
  best-effort basis. File deletions performed inside Bash are not tracked by
  this baseline and therefore cannot be restored by the panel's Undo action.

### Fixed

- The `kimi.yoloMode` setting now reaches the permission engine: enabling it
  maps to the core `yolo` permission mode and takes effect when a session
  attaches, including sessions that previously stored a disabled auto-approve
  state.
- Kept the chat header and input toolbar readable when the sidebar is narrow:
  controls wrap and shrink instead of being clipped.

### Distribution boundary

Release packaging produces target-specific VSIX files for `darwin-x64`,
`darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`.
Archive and static verification for a target does not by itself prove that the
extension has run successfully in that target's Extension Host; runtime test
results must be recorded separately for each operating system and architecture.
