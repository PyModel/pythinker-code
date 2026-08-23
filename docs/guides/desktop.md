# Pythinker Desktop

Pythinker Desktop is a native desktop application for macOS and Windows. It packages the Pythinker
Code runtime together with the browser interface, so you get the same agent as the CLI in a normal
application window — no terminal, and no manual server start.

The application starts a local Host process on the loopback interface and shows its interface in
the application window. Nothing is exposed on the network.

## Download and install

Download the installer for your platform from the
[Pythinker Desktop releases page](https://github.com/PyModel/pythinker-desktop-releases/releases):

| Platform | File |
| --- | --- |
| macOS | `Pythinker-<version>-arm64.dmg` |
| Windows | `Pythinker-<version>-x64-Setup.exe` |

- **macOS**: open the DMG and drag **Pythinker** into `Applications`.
- **Windows**: run the installer. It installs for the current user, so administrator rights are not
  necessary, and you can select the installation directory.

There is no Linux desktop distribution at this time. On Linux, use the
[CLI](./getting-started.md), or run `pythinker web` for the browser interface.

Published releases are signed. Release automation verifies the macOS Gatekeeper and notarization
results and the Windows Authenticode publisher before it makes a release public.

## First launch

Start **Pythinker** as you start any other application. A splash window appears while the local
Host starts, and the main window replaces it when the Host is ready.

The desktop application uses the same data directory as the CLI (`~/.pythinker-code/` by default),
so configuration, providers, MCP servers, and session history are shared. If you already logged in
with the CLI, the desktop application uses the same credentials. If you did not, complete the login
in the application interface. To connect OpenAI Codex, open the provider manager from the sign-in page
or Settings and choose "Sign in with ChatGPT". If the automatic callback fails, paste the redirect URL
from the address bar; see the [OAuth section](../configuration/providers.md#oauth) for this fallback.

For the directory layout, see [Data locations](../configuration/data-locations.md).

## Window and tray behavior

- Closing the window **hides** it. The Host continues to run and your session stays alive.
- The tray icon menu has two items: **Open Pythinker** shows the window again, and **Quit** stops
  the Host and closes the application. The tray icon animates while the Host starts, and becomes
  static when the Host is ready.
- The window stays on the local Host origin. `http` and `https` links open in your system browser.

## Updates

The desktop application checks for updates. Open **Settings > Advanced > Version & updates** to see
the current state and control the process:

- **Automatic update checks** — discover new versions in the background. This is the default.
- **Check for updates** — check immediately.
- **Download update** — start the download and show its percentage, transferred size, total size,
  and speed when available.
- **Restart to update** — appears when an update is downloaded and ready to install.

When a new version is released, the application shows one notification for that version. Choose
**View notes**, **Skip this version**, or **Download update**. Closing the notification keeps the
update available in Settings. Skip applies only to that version. A later version appears normally.

Downloading does not install the update. After the download finishes, choose **Later** to keep it
ready or **Restart to update** to stop the local Host safely, install it, and restart. A normal quit
never installs a downloaded update.

The update controls apply to installed builds only. A development build shows them as unavailable.

## The local Host port

An installed application uses port `24827` on `127.0.0.1`. If that port is already in use, set the
`PYTHINKER_DESKTOP_PORT` environment variable to a free port from 1 to 65535 before you start the
application.

## Troubleshooting

- **The window stays on the splash screen**: the Host did not report readiness. Quit from the tray
  menu and start the application again. If the problem continues, run `pythinker server run` in a
  terminal and read the error it prints.
- **The application reports that the port is in use**: another Pythinker Host, or an unrelated
  process, holds port `24827`. Stop that process, or set `PYTHINKER_DESKTOP_PORT`.
- **The agent cannot use a model**: the desktop application reads the same configuration as the
  CLI. Examine `~/.pythinker-code/config.toml` and see
  [Providers and models](../configuration/providers.md).

## Next steps

- [Getting started](./getting-started.md) — the CLI, installation, and login
- [Sessions and context](./sessions.md) — resuming sessions and compressing context
- [Configuration files](../configuration/config-files.md) — the full configuration reference
