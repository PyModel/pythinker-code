# Configuration files

Pythinker Code CLI writes all long-term preferences — which model to use, which API key to fill in, how many steps an Agent can run per turn — into TOML (a plain-text configuration format with a clear structure) files. Change them once and they take effect on every startup. Agent and runtime settings live in `config.toml`; terminal-UI and client preferences (theme, editor, notifications, status line, auto-update) live in a companion `tui.toml`.

Default location: `~/.pythinker-code/config.toml`, created automatically on first run.

## Config file location

The CLI reads configuration from `~/.pythinker-code/config.toml`. To relocate the data directory, override it with the `PYTHINKER_CODE_HOME` environment variable:

```sh
export PYTHINKER_CODE_HOME=/path/to/pythinker-home
```

The config file path then becomes `$PYTHINKER_CODE_HOME/config.toml`. Regardless of where the directory lives, the file name is always `config.toml`.

::: tip
TOML field names always use snake_case, for example `default_model` and `max_context_size`. If a key contains `.`, you must quote it — for example `[models."gpt-4.1"]` — otherwise TOML treats `.` as a nested table separator.
:::

## Complete example

The following example covers the most commonly used configuration fields. You can copy it and adjust as needed:

```toml
default_model = "moonshot-cn/kimi-k2"
default_thinking = true
default_permission_mode = "manual"
default_plan_mode = false
merge_all_available_skills = true
telemetry = true

[providers."moonshot-cn"]
type = "pythinker"
base_url = "https://api.moonshot.cn/v1"
api_key_env_var = "KIMI_API_KEY"

[models."moonshot-cn/kimi-k2"]
provider = "moonshot-cn"
model = "kimi-k2"
max_context_size = 262144

[thinking]
mode = "auto"

[loop_control]
max_retries_per_step = 10
reserved_context_size = 50000

[background]
max_running_tasks = 4
keep_alive_on_exit = false

[experimental]
micro_compaction = true

[[permission.rules]]
decision = "allow"
pattern = "Read"

[[permission.rules]]
decision = "deny"
pattern = "Bash(rm -rf*)"

[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "node ~/.pythinker-code/hooks/check-bash.mjs"
timeout = 5
```

## Top-level fields

Fields in the config file fall into two categories: **top-level scalars** that directly control default behavior, and **nested tables** (`providers`, `models`, `thinking`, etc.) that each have their own structure, described individually in the sections below.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default_model` | `string` | — | Default model alias; must be defined in `models` |
| `default_thinking` | `boolean` | `false` | Whether new sessions enable Thinking (deep reasoning) mode by default; can be toggled from the model menu inside a session. Even when set to `true`, `[thinking].mode = "off"` will still force Thinking off |
| `default_permission_mode` | `string` | `manual` | Default permission mode for new sessions; one of `manual` (prompt each time), `yolo` (auto-approve tool actions, but the agent may still ask questions), or `auto` (fully autonomous — the agent decides everything without asking, except a `DynamicWorkflow` call, which still shows its plan for approval) |
| `default_plan_mode` | `boolean` | `false` | Whether new sessions start in Plan mode (produce a plan before executing) by default |
| `merge_all_available_skills` | `boolean` | `true` | Whether to merge Agent Skills from all available directories |
| `extra_skill_dirs` | `array<string>` | — | Extra skill search directories, layered on top of the default directories |
| `telemetry` | `boolean` | `true` | Whether anonymous telemetry is enabled; disabled only when explicitly set to `false` |
| `disable_workflows` | `boolean` | `false` | Whether to remove the `DynamicWorkflow` tool and hide `/workflow`; the `PYTHINKER_CODE_DISABLE_WORKFLOWS` environment variable overrides it |
| `workflow_size_guideline` | `string` | `medium` | Advisory subagent-count target for one Dynamic Workflow; one of `small` (about 5), `medium` (about 15), `large` (about 40), or `unrestricted` (no target). Exceeding it emits a warning rather than blocking the run; the `PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE` environment variable overrides it |
| `providers` | `table` | `{}` | API provider table → [`providers`](#providers) |
| `models` | `table` | — | Model alias table → [`models`](#models) |
| `model_roles` | `table` | — | Model role assignments → [`model_roles`](#model_roles) |
| `advisor` | `table` | — | Second-opinion reviewer → [`advisor`](#advisor) |
| `thinking` | `table` | — | Default parameters for Thinking mode → [`thinking`](#thinking) |
| `loop_control` | `table` | — | Agent loop control parameters → [`loop_control`](#loop_control) |
| `background` | `table` | — | Background task runtime parameters → [`background`](#background) |
| `experimental` | `table` | — | Experimental feature overrides → [`experimental`](#experimental) |
| `services` | `table` | — | Built-in external service configuration → [`services`](#services) |
| `permission` | `table` | — | Initial permission rules → [`permission`](#permission) |
| `hooks` | `array<table>` | — | Lifecycle hooks; see [Hooks](../customization/hooks.md) |

The following sections cover each of the nested tables in turn: `providers`, `models`, `model_roles`, `advisor`, `thinking`, `loop_control`, `background`, `experimental`, `services`, and `permission`.

## `providers`

Each entry in the `providers` table defines an API provider, keyed by a unique name. Shell credentials are not guessed automatically: set `api_key_env_var` to opt a provider into reading one named shell variable (see [Config overrides](./overrides.md#provider-credentials)).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `string` | Yes | Provider type: `pythinker`, `anthropic`, `openai`, `openai_responses`, `google-genai`, `vertexai` |
| `api_key` | `string` | No | API key, written in plain text in the config file |
| `api_key_env_var` | `string` | No | Name of a shell environment variable containing the API key; the name is persisted, not its value |
| `base_url` | `string` | No | API base URL |
| `env` | `table<string, string>` | No | Fallback source for provider credentials; see below |
| `custom_headers` | `table<string, string>` | No | Custom HTTP headers attached to each request |
| `source` | `table` | No | Catalog or custom-registry refresh metadata written by provider commands; normally not edited by hand |

**`api_key_env_var`**: The provider resolves this exact name from the process environment when it is used. Missing or blank values fail before a provider request, and redacted configuration APIs report only whether a value is available:

```toml
[providers.deepseek]
type = "openai"
base_url = "https://api.deepseek.com"
api_key_env_var = "DEEPSEEK_API_KEY"
```

**`env` sub-table**: You can write provider-conventional key names (such as `PYTHINKER_API_KEY`) inside `[providers.<name>.env]` as a fallback source for `api_key` / `base_url`. This sub-table is **read only from the config file** and does not modify the shell environment:

```toml
[providers.pythinker.env]
PYTHINKER_API_KEY = "sk-xxx"
PYTHINKER_BASE_URL = "https://api.pythoughts.ai/v1"
```

Priority: `api_key` field > shell value named by `api_key_env_var` > `env` sub-table key > if all are absent, startup fails with an error. `base_url` retains its existing priority: direct field, then the provider-conventional key in the `env` sub-table.

## `models`

Each entry in the `models` table defines a model alias (the name used in `default_model` or the `-m` flag), keyed by a unique name.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `provider` | `string` | Yes | Name of the provider to use; must be defined in `providers` |
| `model` | `string` | Yes | Model identifier sent to the server when calling the API |
| `max_context_size` | `integer` | Yes | Maximum context length in tokens; must be at least 1 |
| `max_output_size` | `integer` | No | Per-request output token cap (maps to `max_tokens`). Currently only the `anthropic` provider honors it; recognized Claude models are automatically clamped to the server-side maximum |
| `capabilities` | `array<string>` | No | Capability tags to add explicitly: `thinking`, `image_in`, `video_in`, `audio_in`, `tool_use`, `fast_mode`. Unioned with the capabilities auto-detected by the provider — entries can only be added, never removed. Add `fast_mode` to a compatible custom gateway only when it implements the provider's native Fast request contract |
| `display_name` | `string` | No | Name shown in the UI; falls back to `model` when unset |
| `reasoning_key` | `string` | No | `openai` provider only. Override the field name used for reasoning content when the gateway returns it under a non-standard name; by default `reasoning_content`, `reasoning_details`, and `reasoning` are auto-detected |
| `adaptive_thinking` | `boolean` | No | `anthropic` provider only. Force adaptive thinking on or off, overriding the version inference based on the model name. Omit to infer automatically (Claude ≥ 4.6 uses adaptive) |

When an alias contains `.`, use a quoted key:

```toml
[models."gpt-4.1"]
provider = "openai"
model = "gpt-4.1"
max_context_size = 1047576
```

You can also switch models temporarily without touching the config file — by setting `PYTHINKER_MODEL_*` environment variables, the CLI synthesizes a temporary provider in memory that does not persist after restart. See [Define a model from environment variables](./env-vars.md#define-a-model-from-environment-variables-pythinker_model).

## `model_roles`

Each entry in the `model_roles` table locks a model alias to a named role. The built-in roles are `small`, `implementer`, and `advisor`; any other key except the reserved `default` defines a custom role. Values must be aliases defined in `models`; an empty string clears the role.

```toml
[model_roles]
small = "haiku"
implementer = "worker-model"
advisor = "reviewer-model"
```

Roles take effect in two places:

- Wherever a subagent model alias is accepted (the `Agent` and `DynamicWorkflow` tool `model` arguments, and agent profile frontmatter), a `@<role>` reference such as `@small` resolves to the locked alias. An unassigned or unresolvable role falls back to the parent agent's model.
- When `implementer` is assigned, it becomes the default model for subagents that do not set an explicit or profile model. Subagents of those subagents inherit the same default.

Inside the TUI, `/model <role>` assigns a role from the model picker, `/model <role> clear` (or `/model <role> none`) removes it, and `/model roles` lists the current assignments. See [Slash commands](../reference/slash-commands.md).

## `advisor`

`advisor` enables a second-opinion reviewer: after a completed user turn, a second model reviews the conversation and returns notes. Notes are delivered at the start of the next turn after the review finishes, so a review may lag a turn.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Turn the advisor on. It also needs a model: set `model` here or lock one to the `advisor` role |
| `model` | `string` | — | Model alias for the advisor; when unset, the `advisor` entry in `model_roles` is used |
| `instructions` | `string` | — | Extra instructions appended to the advisor's system prompt |

The advisor sends the session conversation to the advisor model. As a safety default, it runs only when the advisor model uses the same provider entry as the session model; a cross-provider advisor stays inactive and logs one warning.

Reviews run only for user-started turns, and a turn is skipped when a review is already running. The advisor's token usage is not yet included in usage reporting.

```toml
[advisor]
enabled = true

[model_roles]
advisor = "reviewer-model"
```

## `thinking`

`thinking` sets the global default behavior for Thinking mode. `mode = "off"` forces Thinking off even when the top-level `default_thinking = true`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `string` | — | Trigger policy: `auto` (decided by the model), `on` (always on), `off` (force off) |
| `effort` | `string` | `high` | Thinking effort level: `low`, `medium`, `high`, `xhigh`, `max`; the levels actually available depend on the provider |

## `loop_control`

`loop_control` governs the step count limit, per-step retry count, and the threshold that triggers automatic context compaction in the Agent execution loop.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `max_steps_per_turn` | `integer` | — | Maximum steps per turn; unset or `0` means unlimited |
| `max_retries_per_step` | `integer` | `10` | Maximum retries after a step failure |
| `reserved_context_size` | `integer` | — | Number of tokens reserved for model output; automatic compaction is triggered when the remaining context window falls below this value |

## `background`

`background` controls the concurrency behavior of background tasks (launched via the `Bash` tool or the `Agent` tool's `run_in_background=true` parameter).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `max_running_tasks` | `integer` | — | Maximum number of background tasks running concurrently |
| `keep_alive_on_exit` | `boolean` | `false` | Whether to keep still-running background tasks when the session closes. By default, Pythinker Code requests that all background tasks stop before the process exits; set this to `true` only when you want tasks to outlive the session |

`keep_alive_on_exit` can be overridden by the `PYTHINKER_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT` environment variable, which takes higher priority than `config.toml`.

## `experimental`

`experimental` stores persistent overrides for experimental-feature flags.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `micro_compaction` | `boolean` | `true` | Trim older large tool results from context while preserving recent conversation |
| `tool_intent` | `boolean` | `true` | Ask the model to state a concise intent with each tool call and show it live in the working indicator; set `false` to return to the rotating label |

## `services`

`services` configures two built-in services: web search (`pythoughts_search`) and web fetch (`pythoughts_fetch`). Only these two fixed keys are recognized; other keys are ignored. Both entries share the same fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `base_url` | `string` | No | Service API URL |
| `api_key` | `string` | No | API key |
| `custom_headers` | `table<string, string>` | No | Custom HTTP headers attached to each request |

```toml
[services.pythoughts_search]
base_url = "https://api.pythoughts.com/v1/search"
api_key = "sk-xxx"

[services.pythoughts_fetch]
base_url = "https://api.pythoughts.com/v1/fetch"
api_key = "sk-xxx"
```

## `permission`

`permission` sets permission rules that are automatically loaded when a session starts, controlling whether the Agent needs user confirmation before calling a tool. Rules are written as a `[[permission.rules]]` array of tables, matched in order — the first matching rule takes effect.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `decision` | `string` | Yes | Action on match: `allow` (permit immediately), `deny` (reject immediately), `ask` (prompt each time) |
| `scope` | `string` | No | Rule scope: `turn-override`, `session-runtime`, `project`, `user`; defaults to `user` |
| `pattern` | `string` | Yes | Match pattern in the form `ToolName` or `ToolName(arg-pattern)`, e.g. `Read` or `Bash(rm -rf*)` |
| `reason` | `string` | No | Rule description for debugging and auditing |

Built-in tool names are listed in [Built-in tools](../reference/tools.md). Most built-in tools that accept rule arguments define their own matching subject, such as `Bash(command-pattern)` or `Read(path-pattern)`. `DynamicWorkflow` matches on the plan it is about to run, or on `model:<alias>` for the model a call asks its subagents to use. `Agent` matches on the subagent type, or on `model:<alias>` the same way. MCP tools and custom tools can only be matched by tool name.

```toml
[[permission.rules]]
decision = "allow"
pattern = "Read"

[[permission.rules]]
decision = "allow"
pattern = "Grep"

[[permission.rules]]
decision = "deny"
pattern = "Bash(rm -rf*)"

[[permission.rules]]
decision = "ask"
pattern = "Bash"
```

::: tip
MCP server declarations are configured in `~/.pythinker-code/mcp.json` or the project-local `.pythinker-code/mcp.json`, not in `config.toml`. The interactive configuration entry point is `/mcp-config`; see [Model Context Protocol](../customization/mcp.md).
:::

## `tui.toml`

Alongside `config.toml`, the CLI keeps terminal-UI and client preferences, including status-line visibility, in a companion `tui.toml` in the same directory (`~/.pythinker-code/tui.toml`, or `$PYTHINKER_CODE_HOME/tui.toml` when overridden). It is created with defaults on first run, and the interactive commands `/config`, `/theme`, and `/editor` write to it for you — so you rarely need to edit it by hand. If the file is malformed, the CLI falls back to defaults and shows a notice instead of failing to start.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `theme` | `string` | `auto` | Color theme: `auto` (follow the terminal), `dark`, `light`, or the name of a [custom theme](../customization/themes) |
| `layout` | `string` | `fixed` | Screen layout: `fixed` (full-height screen with the input box pinned to the bottom; the mouse wheel scrolls the transcript and drag-selecting text copies it to the clipboard) or `inline` (legacy flow that grows with the terminal's native scrollback) |
| `[editor].command` | `string` | `""` | External editor command for composing long input; empty falls back to `$VISUAL` / `$EDITOR` |
| `[notifications].enabled` | `boolean` | `true` | Whether desktop notifications are sent |
| `[notifications].notification_condition` | `string` | `unfocused` | When to notify: `unfocused` (only when the terminal is not focused) or `always` |
| `[upgrade].auto_install` | `boolean` | `true` | Whether new versions update automatically. Homebrew downloads and verifies in the background, then installs on the next interactive launch. An explicit `/update` request still completes when this is `false` |
| `[status_line].show_model` | `boolean` | `true` | Show the model name and session spend |
| `[status_line].show_effort` | `boolean` | `true` | Show Thinking effort when `show_model` is also `true` |
| `[status_line].show_token_speed` | `boolean` | `true` | Show live token speed when `show_model` is also `true` |
| `[status_line].show_context_bar` | `boolean` | `true` | Show the context gauge, percentage, and token totals |
| `[status_line].show_git` | `boolean` | `true` | Show the Git branch, changes, and pull request badge |
| `[status_line].show_modes` | `boolean` | `true` | Show Dynamic Workflow, Auto, YOLO, and Plan mode indicators, plus the `↯ fast` suffix when the model is visible |
| `[status_line].show_elapsed` | `boolean` | `true` | Show elapsed time while a request is active |
| `[status_line].show_goal` | `boolean` | `true` | Show the goal badge and make it keyboard-focusable |
| `[status_line].show_background_tasks` | `boolean` | `true` | Show both shell-task and background-agent badges and make them keyboard-focusable |

```toml
# ~/.pythinker-code/tui.toml
theme = "auto" # "auto" | "dark" | "light" | custom theme name
layout = "fixed" # "fixed" | "inline"

[editor]
command = "" # empty uses $VISUAL / $EDITOR

[notifications]
enabled = true
notification_condition = "unfocused" # "unfocused" | "always"

[upgrade]
auto_install = true

[status_line]
show_model = true
show_effort = true
show_token_speed = true
show_context_bar = true
show_git = true
show_modes = true
show_elapsed = true
show_goal = true
show_background_tasks = true
```

Every `[status_line]` field is optional and defaults to `true`. `show_effort` and `show_token_speed` take effect only while `show_model` is enabled, and `show_background_tasks` controls both shell-task and background-agent badges. `show_modes` also controls the dedicated red YOLO mode indicator; its `↯ fast` suffix appears only when `show_model` is enabled too.

This table only hides items already present in the compact status row. It does not control transient hints, validation or activity rows, composer content, welcome-banner tips, working-directory text, or a clock.

Changes apply on the next start, or immediately with `/reload-tui` (which reloads only `tui.toml`); `/reload` reloads both `config.toml` and `tui.toml`.

## Next steps

- [Providers and models](./providers.md) — connection examples for each provider type (Pythinker, Claude, OpenAI, Gemini)
- [Config overrides](./overrides.md) — priority rules for CLI options, config file, and environment variables
- [Environment variables](./env-vars.md) — complete list of runtime variables like `PYTHINKER_CODE_HOME`
