# @pymodel/pythinker-desktop

## 0.3.8

### Patch Changes

- [#225](https://github.com/PyModel/pythinker-code/pull/225) [`f27686a`](https://github.com/PyModel/pythinker-code/commit/f27686ac14eb82b7b2a7773cf936269522479f6c) Thanks [@elkaix](https://github.com/elkaix)! - Install Windows updates in the background instead of opening the installer wizard, and report an update that did not take effect.

## 0.3.1

### Patch Changes

- [#190](https://github.com/PyModel/pythinker-code/pull/190) [`ddf4b88`](https://github.com/PyModel/pythinker-code/commit/ddf4b882e4dd8ea5c5198ebcae8704565708371d) Thanks [@elkaix](https://github.com/elkaix)! - Restore downloadable desktop releases for macOS and Windows.

## 0.3.0

### Minor Changes

- [#185](https://github.com/PyModel/pythinker-code/pull/185) [`283020c`](https://github.com/PyModel/pythinker-code/commit/283020c9138ec1a0fa809b3f4794d6a0e882ebd7) Thanks [@elkaix](https://github.com/elkaix)! - Add signed Beta and Nightly desktop update feeds.

## 0.2.1

### Patch Changes

- [#166](https://github.com/PyModel/pythinker-code/pull/166) [`5560aec`](https://github.com/PyModel/pythinker-code/commit/5560aec41997b522058fc2aeb8af2e29c6d8cc7a) Thanks [@elkaix](https://github.com/elkaix)! - Remove duplicate live activity and keep narrow subagent panel controls visible.

- [#166](https://github.com/PyModel/pythinker-code/pull/166) [`5560aec`](https://github.com/PyModel/pythinker-code/commit/5560aec41997b522058fc2aeb8af2e29c6d8cc7a) Thanks [@elkaix](https://github.com/elkaix)! - Show task outcome cards with subagent model and thinking-effort details in conversations.

## 0.2.0

### Minor Changes

- [#151](https://github.com/PyModel/pythinker-code/pull/151) [`535b2a9`](https://github.com/PyModel/pythinker-code/commit/535b2a94bfc0e614dfeda754da174db9b9a5378e) Thanks [@elkaix](https://github.com/elkaix)! - Say when a new version is found, while it downloads, and when a download fails, instead of only once it is ready to install.

- [#151](https://github.com/PyModel/pythinker-code/pull/151) [`535b2a9`](https://github.com/PyModel/pythinker-code/commit/535b2a94bfc0e614dfeda754da174db9b9a5378e) Thanks [@elkaix](https://github.com/elkaix)! - Give the Windows window its own title bar, so the window controls no longer sit on top of the conversation header and the window can be dragged again.

### Patch Changes

- [#151](https://github.com/PyModel/pythinker-code/pull/151) [`535b2a9`](https://github.com/PyModel/pythinker-code/commit/535b2a94bfc0e614dfeda754da174db9b9a5378e) Thanks [@elkaix](https://github.com/elkaix)! - Remove the "Internal testing only" tag.

## 0.1.6

### Patch Changes

- [#149](https://github.com/PyModel/pythinker-code/pull/149) [`45d1c0a`](https://github.com/PyModel/pythinker-code/commit/45d1c0a49c99cb67c67b4bfa4671d7ef0216865e) Thanks [@elkaix](https://github.com/elkaix)! - Stop a second, unnamed Pythinker icon appearing in the macOS Dock while the app runs.

- [#145](https://github.com/PyModel/pythinker-code/pull/145) [`a0c2705`](https://github.com/PyModel/pythinker-code/commit/a0c2705cf7be9d4d0680aa8f35982a30f7678baa) Thanks [@elkaix](https://github.com/elkaix)! - Stop the desktop app writing its server access token to the log.

## 0.1.3

### Patch Changes

- [#97](https://github.com/PyModel/pythinker-code/pull/97) [`7dd68cb`](https://github.com/PyModel/pythinker-code/commit/7dd68cba572576616dfca1730e79c5e650006508) - Make the workspace header, session timestamps, and the settings row legible in dark mode on the translucent desktop sidebar.

- [#97](https://github.com/PyModel/pythinker-code/pull/97) [`7dd68cb`](https://github.com/PyModel/pythinker-code/commit/7dd68cba572576616dfca1730e79c5e650006508) - Publish desktop releases to a dedicated update channel so update checks resolve a desktop build instead of an unrelated release, and fail the release when a packaged build carries no update feed.

- [#97](https://github.com/PyModel/pythinker-code/pull/97) [`7dd68cb`](https://github.com/PyModel/pythinker-code/commit/7dd68cba572576616dfca1730e79c5e650006508) - Pin the Host port so the desktop app reconnects to its own Host, and stop reporting builds that cannot self-update as update errors.

## 0.1.2

### Patch Changes

- [#82](https://github.com/PyModel/pythinker-code/pull/82) [`1cd8682`](https://github.com/PyModel/pythinker-code/commit/1cd868296da9507cbb28768f71b2611f5ad8a813) - Sign the Windows installer through Azure Artifact Signing when the signing environment is configured

- [#82](https://github.com/PyModel/pythinker-code/pull/82) [`1cd8682`](https://github.com/PyModel/pythinker-code/commit/1cd868296da9507cbb28768f71b2611f5ad8a813) - Render the Windows desktop window opaquely so the theme colours are not blended with the desktop wallpaper

## 0.1.1

### Patch Changes

- [#81](https://github.com/PyModel/pythinker-code/pull/81) [`8717330`](https://github.com/PyModel/pythinker-code/commit/8717330b22049faf1d45be97dfee814b5272a33b) - Bound the Windows process-tree kill so a stalled taskkill cannot freeze desktop shutdown

- [#81](https://github.com/PyModel/pythinker-code/pull/81) [`8717330`](https://github.com/PyModel/pythinker-code/commit/8717330b22049faf1d45be97dfee814b5272a33b) - Fix Windows runtime staging and skip empty signing credentials in the desktop release workflow

- [#81](https://github.com/PyModel/pythinker-code/pull/81) [`8717330`](https://github.com/PyModel/pythinker-code/commit/8717330b22049faf1d45be97dfee814b5272a33b) - Stage the desktop Host closure inside the workspace so pnpm deploy resolves the target on Windows

- [#81](https://github.com/PyModel/pythinker-code/pull/81) [`8717330`](https://github.com/PyModel/pythinker-code/commit/8717330b22049faf1d45be97dfee814b5272a33b) - Add the Windows NSIS installer target, release script, and release workflow job

- [#81](https://github.com/PyModel/pythinker-code/pull/81) [`8717330`](https://github.com/PyModel/pythinker-code/commit/8717330b22049faf1d45be97dfee814b5272a33b) - Fix Windows process-tree shutdown, packaged-runtime guards, and taskbar identity in the desktop app
