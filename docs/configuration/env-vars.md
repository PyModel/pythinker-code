# Environment variables

Pythinker Code CLI uses environment variables to control a small number of runtime behaviors — relocating the data directory, turning off telemetry, and temporarily switching models without touching the config file.

::: warning Important: API keys are explicitly referenced
Credential variables such as `PYTHINKER_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY` are not guessed automatically. A provider reads a shell credential only when `[providers.<name>].api_key_env_var` names it. Catalog import writes this reference for supported providers without writing the token itself.

The `PYTHINKER_MODEL_*` family remains a separate explicit channel that synthesizes a temporary provider — see [Define a model from environment variables](#define-a-model-from-environment-variables-pythinker-model).

For background, see [Config overrides: provider credentials](./overrides.md#provider-credentials).
:::

## Core paths

### `PYTHINKER_CODE_HOME`

Overrides the data root directory; the default is `~/.pythinker-code`. Once set, the config file, sessions, logs, credentials, and all other data land under the new path:

```sh
export PYTHINKER_CODE_HOME="/path/to/custom/pythinker-code"
```

> Make sure the directory is writable. Multiple `pythinker` instances sharing the same `PYTHINKER_CODE_HOME` will share config and credential files.

For the complete data directory structure, see [Data locations](./data-locations.md).

### `PYTHINKER_DISABLE_TELEMETRY`

Set to `1` to turn off anonymous telemetry reporting (also accepts `true`, `yes`, `y`, case-insensitive):

```sh
export PYTHINKER_DISABLE_TELEMETRY=1
```

### `PYTHINKER_MODEL_*` family

Switch models temporarily without modifying `config.toml` — when `PYTHINKER_MODEL_NAME` is set, the CLI synthesizes a temporary provider in memory; the change does not persist after restart. See [Define a model from environment variables](#define-a-model-from-environment-variables-pythinker_model).

## Provider credential environment references

Use `api_key_env_var` when the secret should remain in the process environment:

```toml
[providers.anthropic]
type = "anthropic"
api_key_env_var = "ANTHROPIC_API_KEY"
```

```sh
export ANTHROPIC_API_KEY=YOUR_API_KEY
pythinker
```

The legacy `[providers.<name>.env]` sub-table remains a literal config-file fallback for `api_key` and `base_url`; it does not read or modify the shell environment:

```toml
[providers.pythinker.env]
PYTHINKER_API_KEY = "YOUR_API_KEY"
PYTHINKER_BASE_URL = "https://api.example.com/v1"
```

Provider-conventional config-subtable keys:

| Key | Applicable provider | Default |
| --- | --- | --- |
| `PYTHINKER_API_KEY` | Pythinker / Pythoughts | None |
| `PYTHINKER_BASE_URL` | Pythinker / Pythoughts | `https://api.pythoughts.ai/v1` |
| `ANTHROPIC_API_KEY` | Anthropic | None |
| `ANTHROPIC_BASE_URL` | Anthropic | Follows Anthropic SDK default |
| `OPENAI_API_KEY` | OpenAI (`openai` and `openai_responses`) | None |
| `OPENAI_BASE_URL` | OpenAI (`openai` and `openai_responses`) | `https://api.openai.com/v1` |
| `GOOGLE_API_KEY` | Google GenAI, Vertex AI | None |
| `VERTEXAI_API_KEY` | Vertex AI | None |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI | None |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI | None |

Catalog entries can declare other credential names and persist them through `api_key_env_var`. The featured connections currently declare:

| Catalog provider | Credential variable |
| --- | --- |
| DeepSeek (`deepseek`) | `DEEPSEEK_API_KEY` |
| GLM Coding Plan (`zai-coding-plan`) | `ZHIPU_API_KEY` |
| MiniMax Token Plan (`minimax-coding-plan`) | `MINIMAX_API_KEY` |
| Kimi For Coding (`kimi-for-coding`) | `KIMI_API_KEY` |

::: warning
`GOOGLE_APPLICATION_CREDENTIALS` (path to a service account JSON file) is read directly by the Google SDK through the standard ADC flow; `api_key_env_var` is not involved in that path.
:::

For the full provider type and field reference, see [Providers and models](./providers.md).

## Define a model from environment variables (`PYTHINKER_MODEL_*`)

Want to switch models for testing without touching `config.toml`? When `PYTHINKER_MODEL_NAME` is set, the CLI synthesizes a temporary provider and model alias from the `PYTHINKER_MODEL_*` variables in memory — nothing is written back to the config file. These variables take priority over `default_model` in `config.toml`, but the `-m <alias>` option at startup still has the highest priority.

```sh
export PYTHINKER_MODEL_NAME="pythinker-for-coding"
export PYTHINKER_MODEL_API_KEY="YOUR_API_KEY"
export PYTHINKER_MODEL_BASE_URL="https://api.example.com/v1"
export PYTHINKER_MODEL_MAX_CONTEXT_SIZE="262144"
export PYTHINKER_MODEL_CAPABILITIES="image_in,thinking"
pythinker
```

Complete variable list:

| Variable | Required | Purpose | Default |
| --- | --- | --- | --- |
| `PYTHINKER_MODEL_NAME` | Yes (also the enable switch) | Model id sent to the API | — |
| `PYTHINKER_MODEL_API_KEY` | Yes | API key | — |
| `PYTHINKER_MODEL_PROVIDER_TYPE` | No | Provider type: `pythinker`, `anthropic`, `openai` | `pythinker` |
| `PYTHINKER_MODEL_BASE_URL` | No | API base URL | Each type has its own default |
| `PYTHINKER_MODEL_MAX_CONTEXT_SIZE` | No | Maximum context length (tokens) | `262144` (256 K) |
| `PYTHINKER_MODEL_CAPABILITIES` | No | Comma-separated capability tags, unioned with auto-detected capabilities | `image_in,thinking` |
| `PYTHINKER_MODEL_DISPLAY_NAME` | No | Name shown in `/model` | Falls back to `PYTHINKER_MODEL_NAME` |
| `PYTHINKER_MODEL_MAX_OUTPUT_SIZE` | No | Per-request output cap (`anthropic` only) | Model default |
| `PYTHINKER_MODEL_REASONING_KEY` | No | Reasoning field name override (`openai` only) | Auto-detected |
| `PYTHINKER_MODEL_DEFAULT_THINKING` | No | Default Thinking toggle for new sessions | Follows global default |
| `PYTHINKER_MODEL_THINKING_MODE` | No | Thinking trigger policy: `auto`/`on`/`off` | — |
| `PYTHINKER_MODEL_THINKING_EFFORT` | No | Thinking effort level: `low`/`medium`/`high`/`xhigh`/`max` | — |
| `PYTHINKER_MODEL_ADAPTIVE_THINKING` | No | Force adaptive thinking on or off (`anthropic` only) | Inferred from model name |

If `PYTHINKER_MODEL_NAME` is set but a required variable is missing, startup fails immediately with a clear error message.

## Runtime switches

Switches that control the behavior of subsystems such as telemetry, background tasks, and the plugin marketplace:

| Variable | Purpose | Valid values |
| --- | --- | --- |
| `PYTHINKER_DISABLE_TELEMETRY` | Disable anonymous telemetry reporting | `1`, `true`, `yes`, `y` (case-insensitive) |
| `PYTHINKER_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT` | Whether to keep background tasks when the session closes; takes higher priority than `config.toml`. The default is to stop them on exit | Truthy: `1`/`true`/`yes`/`on`; falsy: `0`/`false`/`no`/`off` |
| `PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL` | Override the plugin marketplace JSON loaded by `/plugins` | URL or local path |
| `PYTHINKER_CODE_DISABLE_WORKFLOWS` | Disable Dynamic Workflow: the `DynamicWorkflow` tool is not registered and `/workflow` is hidden; takes higher priority than `config.toml` | Truthy: `1`/`true`/`yes`/`on`; falsy: `0`/`false`/`no`/`off` |
| `PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE` | Override the advisory Dynamic Workflow size guideline injected into the tool guidance; takes higher priority than `config.toml` | `small`, `medium`, `large`, `unrestricted` |
| `PYTHINKER_CODE_EXPERIMENTAL_FLAG` | Enable all registered experimental features for this process; `micro_compaction` is already enabled by default | `1`, `true`, `yes`, `on` |
| `PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION` | Override [`[experimental].micro_compaction`](./config-files.md#experimental) for this process | Truthy or falsy |
| `PYTHINKER_SHELL_PATH` | Override the Git Bash path on Windows (used when auto-detection fails) | Absolute path |
| `PYTHINKER_MODEL_MAX_COMPLETION_TOKENS` | Hard cap on `max_completion_tokens` per LLM step; applies to the `pythinker` provider only | Positive integer; `0` or negative disables clamping |
| `PYTHINKER_MODEL_TEMPERATURE` | Sampling temperature for every request; applies to the `pythinker` provider only (global — independent of `PYTHINKER_MODEL_NAME`) | Number, e.g. `0.3` |
| `PYTHINKER_MODEL_TOP_P` | Nucleus-sampling `top_p` for every request; applies to the `pythinker` provider only (global) | Number, e.g. `0.95` |
| `PYTHINKER_MODEL_THINKING_KEEP` | Pythoughts preserved-thinking passthrough (`thinking.keep`); applies to the `pythinker` provider only, and only while Thinking is on | A value the API accepts, e.g. `all` |
| `PYTHINKER_CODE_NO_AUTO_UPDATE` | Disable automatic update checks, background preparation or installation, restart activation, and prompts. An explicit `/update` request is still completed; the legacy alias `PYTHINKER_CLI_NO_AUTO_UPDATE` is also honored | Truthy: `1`/`true`/`yes`/`on` |
| `PYTHINKER_DISABLE_CRON` | Disable the scheduled-task tool (`CronCreate` rejects new schedules; existing tasks do not fire) | `1` to disable |

## Diagnostic logs

These variables control log level and file rotation, read once at process startup:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PYTHINKER_LOG_LEVEL` | Log level: `off`, `error`, `warn`, `info`, `debug` | `info` |
| `PYTHINKER_LOG_GLOBAL_MAX_BYTES` | Maximum bytes per global log file | `6291456` (6 MB) |
| `PYTHINKER_LOG_GLOBAL_FILES` | Number of global log files to retain | `5` |
| `PYTHINKER_LOG_SESSION_MAX_BYTES` | Maximum bytes per session log file | `5242880` (5 MB) |
| `PYTHINKER_LOG_SESSION_FILES` | Number of session log files to retain | `3` |

## System environment variables

The CLI also reads several standard system variables to detect the runtime environment; it does not modify them:

- `HOME`: used to resolve the default data path
- `VISUAL`, `EDITOR`: external editor command (`VISUAL` takes precedence)
- `PATH`: used to locate dependencies such as `rg`, `fd`, `fdfind`, and `git`; on Windows, Git Bash detection checks each `git.exe` found on `PATH`, including package-manager shims such as Scoop
- `NO_COLOR`, `FORCE_COLOR`: control color output (following the [no-color.org](https://no-color.org) convention)
- `CI`: when non-empty and not `"0"`, disables theme detection and falls back to the dark theme
- `TERM_PROGRAM`, `TERM`, `TMUX`: detect terminal features and notification support
- `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`: detect Linux graphical sessions (for clipboard and image features)
- `WSL_DISTRO_NAME`, `WSLENV`: detect WSL for the clipboard PowerShell bridge
- `LOCALAPPDATA`: used on Windows as a fallback when probing for the Git Bash installation path

## HTTP proxy

Pythinker Code honors the standard proxy environment variables for all outbound traffic — model API calls, MCP servers, web tools, telemetry, sign-in, and update checks:

- `HTTP_PROXY` / `http_proxy`: proxy for `http://` requests
- `HTTPS_PROXY` / `https_proxy`: proxy for `https://` requests
- `ALL_PROXY` / `all_proxy`: fallback proxy used when the scheme-specific variable is unset; this is where a SOCKS proxy is usually set
- `NO_PROXY` / `no_proxy`: comma-separated hosts that bypass the proxy

Both HTTP(S) and SOCKS proxies are supported. A SOCKS proxy is recognized by its scheme — `socks5://`, `socks5h://`, `socks4://`, or `socks://` (an alias for `socks5://`) — and is typically set via `ALL_PROXY` (the form used by tools like Clash and V2RayN). An HTTP(S) proxy takes precedence over `ALL_PROXY` for HTTP/HTTPS traffic.

The proxy is applied only when one of these variables is set; otherwise connections are made directly. Loopback hosts (`localhost`, `127.0.0.1`, `::1`) always bypass the proxy, so a local server such as a localhost MCP server keeps working when a proxy is configured — add your own internal hosts to `NO_PROXY` to exempt them too.

Stdio MCP servers that run as Node child processes honor `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` automatically when the child's Node version supports `NODE_USE_ENV_PROXY` (Node ≥ 22.21 or ≥ 24.5); SOCKS proxying applies to Pythinker Code's own traffic only.

## Next steps

- [Config overrides](./overrides.md) — how environment variables, CLI options, and the config file interact by priority
- [Data locations](./data-locations.md) — directory structure affected by `PYTHINKER_CODE_HOME`
- [Providers and models](./providers.md) — full connection examples per provider type
