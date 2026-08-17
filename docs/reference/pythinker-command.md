# `pythinker` Command

`pythinker` is the main command for Pythinker Code CLI, used to start an interactive session in the terminal. Running it without any arguments opens a new session in the current working directory; combined with different flags, you can resume a previous session, skip approvals, start in Plan mode, or load Skills from a custom directory.

```sh
pythinker [options]
pythinker <subcommand> [options]
```

## Main Command Options

All flags are optional — run `pythinker` directly to enter an interactive session:

| Option | Short | Description |
| --- | --- | --- |
| `--version` | `-V` | Print the version number and exit |
| `--help` | `-h` | Show help information and exit |
| `--session [id]` | `-S` | Resume a session. With an ID, opens that session directly; without an ID, enters an interactive selector |
| `--continue` | `-C` | Continue the most recent session in the current working directory, without specifying an ID manually |
| `--model <model>` | `-m` | Specify a model alias for this launch. When omitted, new sessions use `default_model` from the config file |
| `--prompt <prompt>` | `-p` | Run a single prompt non-interactively and stream the Assistant output to stdout. This mode does not open the TUI |
| `--output-format <format>` | | Set the non-interactive output format; supports `text` and `stream-json`. Can only be used with `--prompt`; defaults to `text` |
| `--yolo` | `-y` | Auto-approve regular tool calls, skipping approval requests |
| `--auto` | | Start with auto permission mode; tool approvals are handled automatically and the Agent will not ask the user questions |
| `--plan` | | Start a new session in Plan mode — the AI will prioritize read-only tools for exploration and planning |
| `--skills-dir <dir>` | | Load Skills from the specified directory, replacing the automatically discovered user and project directories. Can be repeated |

`-r` / `--resume` is a hidden alias for `--session`; `--yes` and `--auto-approve` are hidden aliases for `--yolo` and are not shown in help output.

::: warning
`--yolo` skips human approval for regular tool calls, including file writes and shell command execution. Use it only in trusted working directories. Plan mode exit approval is not bypassed by `--yolo`; `Bash` inside Plan mode is handled under the regular allow rules.
:::

### Flag Conflict Rules

The following combinations are rejected at startup:

- `--continue` and `--session` are mutually exclusive — both mean "resume a previous session"
- `--yolo` and `--auto` are mutually exclusive — the two permission modes cannot be combined
- `--prompt` cannot be used with `--yolo`, `--auto`, or `--plan` — non-interactive mode uses `auto` permission by default
- `--output-format` can only be used together with `--prompt`

When resuming a session, you can override its saved permission or plan mode by adding `--auto`, `--yolo`, or `--plan`. For example, `pythinker --continue --auto` resumes the latest session and switches it to auto permission mode.

## Common Usage

Start a new session directly:

```sh
pythinker
```

Pick up where you left off (automatically finds the most recent session in the current directory):

```sh
pythinker --continue
```

Choose from the session history list, or specify a known ID directly:

```sh
pythinker --session
pythinker --session 01HZ...XYZ
```

Skip approval prompts — suitable for batch tasks that are known to be safe:

```sh
pythinker --yolo
```

Let the Agent handle everything autonomously, without asking the user questions:

```sh
pythinker --auto
```

Read the code and produce an implementation plan before making any file changes:

```sh
pythinker --plan
```

### Custom Skills Directories

There are two ways to specify Skills directories, with different semantics:

- **`--skills-dir <dir>`** (CLI flag): **Replaces** the automatically discovered user and project directories for this launch only. Can be repeated to stack multiple directories:

  ```sh
  pythinker --skills-dir /path/to/team-skills --skills-dir ./local-skills
  ```

- **`extra_skill_dirs`** (`config.toml`): **Adds** directories on top of the automatically discovered ones, taking effect permanently. Suitable for configuring team-shared Skills. See [Agent Skills](../customization/skills.md).

## Non-Interactive Execution

When running a single prompt in a script or CI environment, use `-p`:

```sh
pythinker -p "Summarize the current repository status"
```

Output uses a transcript style: thinking content and Assistant text are both prefixed with `• `, and wrapped lines are indented by two spaces. Assistant text goes to stdout; thinking, tool progress, and "resuming session" notices go to stderr. In `-p` mode, no human approval is requested — regular tool calls are handled under the `auto` permission policy, while static deny rules remain in effect.

Temporarily switch the model:

```sh
pythinker -m pythinker-code/pythinker-for-coding -p "Explain the latest diff"
```

When you need to parse output programmatically, use the `stream-json` format — each line on stdout is a JSON object:

```sh
pythinker -p "List changed files" --output-format stream-json
```

In `stream-json` mode, regular replies produce an Assistant message; when the model calls a tool, an Assistant message with `tool_calls` is emitted first, followed by the corresponding Tool message, then subsequent Assistant messages. Thinking content is not written to JSONL; tool progress and "resuming session" notices are still written to stderr.

## Subcommands

`pythinker` provides the following subcommands: `login` (non-interactive login), `acp` (ACP IDE mode), `server` (run and manage the local REST/WebSocket/web service), `web` (alias for `pythinker server run --open`), `doctor` (validate configuration files), `export` (export a session), `upgrade` (check for updates), and `provider` (manage providers).

### `pythinker login`

Log in to Pythinker Code OAuth via the RFC 8628 device-code flow, without entering the TUI. The command issues a device authorization request, prints the verification URL and user code to stderr, then polls until the browser-side authorization is complete. The generated token is written to the same local location as TUI `/login` and is loaded automatically the next time `pythinker` starts.

```sh
pythinker login
```

This subcommand has no flags. Press `Ctrl-C` at any time during polling to cancel; the exit code is `1` on cancellation or failure, and `0` on success.

### `pythinker acp`

Switch Pythinker Code CLI to ACP (Agent Client Protocol) mode, communicating with an IDE via JSON-RPC over stdin/stdout so the editor can directly drive pythinker's sessions and tool calls. You typically do not need to run this manually — the IDE starts it as a subprocess entry point. For configuration, see [Using in IDEs](../guides/ides.md); for technical details, see the [pythinker acp reference](./pythinker-acp.md).

```sh
pythinker acp
```

### `pythinker server`

Run, install, and manage the local Pythinker server — a single process that exposes the REST + WebSocket API and serves the web UI from the same origin. The parent command is split into an on-demand entrypoint (`run`) and an OS-managed service lifecycle (`install`, `uninstall`, `start`, `stop`, `restart`, `status`). `pythinker server run` ensures a single background daemon is running and returns once it is healthy; pass `--foreground` to keep the server attached to the current terminal instead.

When the server is running, `GET /openapi.json` returns the REST OpenAPI document and `GET /asyncapi.json` returns the local WebSocket AsyncAPI document.

```sh
pythinker server run                # start or reuse a background daemon
pythinker server run --foreground   # run attached to the current terminal
pythinker server install            # register with launchd / systemd / schtasks
pythinker server start              # start the OS-managed service
pythinker server status             # snapshot of installed/running state
```

#### `pythinker server run`

| Option | Description |
| --- | --- |
| `--port <port>` | Bind port; defaults to `58627` |
| `--log-level <level>` | Enable server logs at the selected level; omitted by default |
| `--debug-endpoints` | Mount `/api/v1/debug/*` routes (off by default) |
| `--foreground` | Run in the foreground instead of spawning a background daemon |
| `--open` | Open the web UI in the default browser once the server is healthy |

`pythinker server run` binds to local loopback only. By default it spawns a single background daemon (reused across runs) and exits once the daemon is healthy; the daemon shuts itself down after the last web client disconnects. Pass `--foreground` to run the server in the current process instead — it then stays attached to the terminal and shuts down cleanly on `SIGINT` / `SIGTERM`.

#### `pythinker server install`

Register the server as an OS-managed service so it starts at login and restarts after a crash. The backend picks itself based on the running platform:

- **macOS**: writes a LaunchAgent plist to `~/Library/LaunchAgents/ai.pythoughts.pythinker-server.plist` and bootstraps it via `launchctl bootstrap gui/<uid>`.
- **Linux**: writes a `--user` systemd unit to `~/.config/systemd/user/pythinker-server.service` and runs `systemctl --user enable --now`.
- **Windows**: registers a scheduled task named `PythinkerServer` via `schtasks /Create /XML`.

| Option | Description |
| --- | --- |
| `--port <port>` | Bind port the supervised server uses; defaults to `58627` |
| `--log-level <level>` | Log level recorded in the generated unit |
| `--force` | Replace an existing install instead of failing |
| `--json` | Output JSON instead of a human-readable line |

The loopback host, chosen port, and log level are recorded to `~/.pythinker-code/server/install.json` so `pythinker server status` can report them even when the service is stopped.

#### Lifecycle subcommands

| Command | Description |
| --- | --- |
| `pythinker server uninstall` | Stop and remove the OS service definition. Idempotent. |
| `pythinker server start` | Start the OS-managed service. Errors if not installed. |
| `pythinker server stop` | Stop the OS-managed service. |
| `pythinker server restart` | Restart the OS-managed service. |
| `pythinker server status` | Print installed / running / pid / port / log-path. `--json` for automation. |

#### `pythinker web`

Alias for `pythinker server run` with `--open` defaulted to `true` — runs the server in the foreground and opens the web UI in the default browser once it is healthy. Use `--no-open` to skip the browser launch (effectively turning it back into `pythinker server run`).

```sh
pythinker web                        # foreground + open browser
pythinker web --no-open              # equivalent to `pythinker server run`
```

The same `--port`, `--log-level`, and `--debug-endpoints` flags work as on `pythinker server run`.

### `pythinker doctor`

Validate `config.toml` and `tui.toml` without starting the TUI or modifying either file. By default, the command checks the files under `PYTHINKER_CODE_HOME` (or `~/.pythinker-code` when the environment variable is unset). Missing default files are reported as skipped because built-in defaults can apply.

```sh
pythinker doctor
```

| Command | Description |
| --- | --- |
| `pythinker doctor` | Validate the default `config.toml` and `tui.toml` |
| `pythinker doctor config [path]` | Validate only `config.toml`, using `path` instead of the default file when provided |
| `pythinker doctor tui [path]` | Validate only `tui.toml`, using `path` instead of the default file when provided |

When an explicit path is passed, the file must exist. The default report also shows the effective automatic-update mode, a prepared Homebrew version or active operation, the last failure, and the installer log path. The command exits with `0` when all checked files are valid or skipped, and `1` when any requested file is missing or invalid.

```sh
# Check the default config files
pythinker doctor

# Check only the default runtime config
pythinker doctor config

# Check a candidate TUI config before replacing the live config
pythinker doctor tui ./tui.toml
```

### `pythinker export`

Package a session into a ZIP file for sharing, archiving, or submitting bug reports.

```sh
pythinker export [sessionId] [options]
```

| Parameter / Option | Short | Description |
| --- | --- | --- |
| `sessionId` | | The ID of the session to export. When omitted, the most recent session in the current working directory is automatically selected and requires confirmation |
| `--output <path>` | `-o` | Output ZIP file path. When omitted, writes to a default filename in the current directory |
| `--yes` | `-y` | Skip the confirmation prompt for the default session and export directly |
| `--no-include-global-log` | | Do not include the global diagnostic log. Included by default |

The export contains all files in the target session directory. The global diagnostic log (`~/.pythinker-code/logs/pythinker-code.log`) is included by default because it may contain events from other sessions or projects; add `--no-include-global-log` if you do not want to share it.

```sh
# Export the most recent session in the current directory, skipping confirmation
pythinker export -y

# Export a specific session to a custom path
pythinker export 01HZ...XYZ -o ./bug-report.zip

# Exclude the global diagnostic log
pythinker export 01HZ...XYZ -o ./bug-report.zip --no-include-global-log
```

### `pythinker upgrade`

Immediately check for the latest version and display an update prompt; exits after you make a selection.

```sh
pythinker upgrade
```

For global npm, pnpm, yarn, bun, and macOS / Linux native installations, `pythinker upgrade` shows update options; selecting `Install update now` runs the corresponding foreground install command. Homebrew and Windows native installations print their package-manager or installer command instead. During normal interactive launches, automatic Homebrew updates use a separate restart-safe flow: the source archive is prepared and verified in the background, then installed on the next launch.

### `pythinker dashboard`

Launch the session dashboard in your browser to inspect a session as it unfolds. The command starts an in-process server pointed at your local sessions, prints the URL, opens your browser, and keeps running until you press `Ctrl-C`.

```sh
pythinker dashboard [sessionId] [options]
```

| Parameter / Option | Description |
| --- | --- |
| `sessionId` | Open the visualizer directly to this session. When omitted, it opens the home view listing your sessions |
| `--port <number>` | Port to bind. By default an available port is picked automatically |
| `--host <host>` | Host to bind. Default: `127.0.0.1` |
| `--no-open` | Do not open the browser automatically; just print the URL |

```sh
# Start the visualizer and open the browser at the home view
pythinker dashboard

# Open directly to a specific session
pythinker dashboard 01HZ...XYZ

# Bind a fixed port and host without opening a browser (e.g. on a remote host)
pythinker dashboard --host 0.0.0.0 --port 8123 --no-open
```

### `pythinker provider`

Manage providers in the shell — the non-interactive equivalent of `/provider` in the TUI. Suitable for scripted deployments, CI initialization, and one-line setup on a new machine.

```sh
pythinker provider <action> [options]
```

Five actions are available:

#### `pythinker provider add <url>`

Bulk-import all providers from a custom registry (`api.json`). The command fetches the registry, creates a `[providers.<id>]` and `[models.<alias>]` entry for each item, and writes `source` metadata so the TUI refreshes providers and models from the same registry URL automatically on next startup.

| Parameter / Option | Description |
| --- | --- |
| `<url>` | Registry URL |
| `--api-key <key>` | Bearer token for accessing the registry. Falls back to the `PYTHINKER_REGISTRY_API_KEY` environment variable if not provided; required |

```sh
pythinker provider add https://registry.example.com/v1/models/api.json --api-key YOUR_KEY

# Or via environment variable (suitable for CI / .envrc)
PYTHINKER_REGISTRY_API_KEY=YOUR_KEY pythinker provider add https://registry.example.com/v1/models/api.json
```

If a provider ID already exists, it is removed and re-created. The default model is not set automatically; you can select one later with `-m` or `/model` in the TUI.

#### `pythinker provider remove <providerId>`

Remove the specified provider and all its model aliases. If the removed provider is the one referenced by `default_model`, `default_model` is also cleared.

```sh
pythinker provider remove kohub
```

#### `pythinker provider list`

Print each configured provider on a separate line, including type, model count, and source. Add `--json` to output the raw `providers` and `models` tables for programmatic processing.

```sh
pythinker provider list
pythinker provider list --json | jq '.providers | keys'
```

#### `pythinker provider catalog list [providerId]`

Browse the public [models.dev](https://models.dev/) model catalog without modifying any configuration. Without an argument, lists all providers along with their protocol type and model count; with a `providerId`, lists all models under that provider along with their context window and capabilities.

| Parameter / Option | Description |
| --- | --- |
| `[providerId]` | Optional — the provider ID to inspect |
| `--filter <substring>` | Case-insensitive substring filter on ID or name |
| `--url <url>` | Override the catalog URL; defaults to `https://models.dev/api.json` |
| `--json` | Output matching entries as JSON |

```sh
pythinker provider catalog list
pythinker provider catalog list --filter anthropic
pythinker provider catalog list anthropic
```

#### `pythinker provider catalog add <providerId>`

Import a known provider directly from the catalog by ID. The protocol type, base URL, credential-variable name, and model information come from the catalog. The named environment variable must contain a nonempty API key or coding-plan token when the command runs; only its name is persisted.

| Parameter / Option | Description |
| --- | --- |
| `<providerId>` | Provider ID in the catalog, e.g., `anthropic`, `openai` |
| `--api-key-env <name>` | Override the catalog-declared environment-variable name containing the provider credential |
| `--default-model <modelId>` | Optional — set `default_model` to `<providerId>/<modelId>` after import |
| `--url <url>` | Override the catalog URL; defaults to `https://models.dev/api.json` |

```sh
pythinker provider catalog list anthropic          # Browse available models first
export ANTHROPIC_API_KEY=YOUR_API_KEY
pythinker provider catalog add anthropic --default-model claude-opus-4-7
```

## Next steps

- [Slash Commands](./slash-commands.md) — Quick reference for control commands in the interactive TUI
- [Configuration Files](../configuration/config-files.md) — Persistent configuration for `default_model`, permission mode, and other startup parameters
- [Agent Skills](../customization/skills.md) — Skill file format for directories loaded via `--skills-dir`
