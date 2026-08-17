# @pymodel/pythinker-desktop

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
