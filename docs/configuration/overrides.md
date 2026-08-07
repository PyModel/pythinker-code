# Config overrides

Pythinker Code CLI has three places where runtime parameters can be influenced: the config file, command-line options, and environment variables. They are not a simple "whoever has higher priority wins" relationship — the three serve different scenarios and have non-overlapping scopes:

- **Config file** stores long-term preferences (model, keys, loop control, etc.); takes effect on every startup
- **Command-line options** make one-off changes for the current startup; discarded after exit
- **Environment variables** primarily handle data directory location, OAuth endpoint switching, and a small number of runtime switches — **not a general fallback mechanism for config fields**

This distinction matters: exporting a credential does not select a provider or guess which provider should consume it. The provider must explicitly name the variable with `api_key_env_var`. See [Provider credentials](#provider-credentials) below.

## Three roles of environment variables

Environment variables fall into four categories by function and cannot be collapsed into a single linear priority order:

1. **Locating the config file**: `PYTHINKER_CODE_HOME` sets the data root directory, making the config file path `$PYTHINKER_CODE_HOME/config.toml`. This step runs before all other resolution and is not a fallback for individual parameters.
2. **Runtime switches**: A small set of variables like `PYTHINKER_DISABLE_TELEMETRY` directly shut down the corresponding subsystem — even if `config.toml` has `telemetry = true`, setting this variable to a truthy value disables telemetry. The semantics are "additionally disable", not "ordinary override".
3. **Explicit provider credentials**: `api_key_env_var` opts one provider into reading one exact shell variable. Catalog imports write this name while keeping the value out of `config.toml`.
4. **Runtime endpoints and diagnostics**: Variables like `PYTHINKER_LOG_LEVEL` are read when the corresponding subsystem initializes. For the full list, see [Environment variables](./env-vars.md).

## Priority for ordinary runtime parameters

For ordinary runtime parameters such as model alias, Plan mode, yolo mode, and Skills directories, priority from highest to lowest is:

1. **Command-line options** (`-m`, `--plan`, `--yolo`, etc.): apply only to the current startup
2. **User config file** (`~/.pythinker-code/config.toml`): stores long-term preferences

A small number of environment variables explicitly override specific config file fields — for example, `PYTHINKER_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT` has higher priority than `[background].keep_alive_on_exit`. These exceptions are noted in [Environment variables](./env-vars.md) and in the relevant field descriptions in [Configuration files](./config-files.md).

::: warning
**Ordinary runtime parameters do not fall back to shell environment variables.** Provider `base_url` is still read from `config.toml` (including the `[providers.<name>.env]` sub-table). An API key is read from the shell only through the provider's explicit `api_key_env_var`; the separate `PYTHINKER_MODEL_*` channel can synthesize a temporary provider — see [Define a model from environment variables](./env-vars.md#define-a-model-from-environment-variables-pythinker-model).
:::

The CLI currently reads a single user-level config file and has no project-level config file mechanism. To isolate config between different projects, point `PYTHINKER_CODE_HOME` at different data directories — see [Common scenarios](#common-scenarios) below.

## Provider credentials

Provider credentials (`api_key`, `base_url`) follow their own resolution rules, separate from the ordinary parameter priority chain.

For a single provider, credentials are resolved in this order:

1. `[providers.<name>].api_key` — key written directly in the config file; highest priority
2. The shell value named by `[providers.<name>].api_key_env_var` — consulted only when `api_key` is empty
3. The matching key inside the `[providers.<name>.env]` sub-table (`PYTHINKER_API_KEY`, `ANTHROPIC_API_KEY`, etc.) — consulted only when the earlier sources are absent
4. If all are absent — startup fails with an error indicating the provider is missing credentials

`base_url` is resolved the same way: first `[providers.<name>].base_url`, then the `*_BASE_URL` key in `[providers.<name>.env]`.

> The `[providers.<name>.env]` sub-table is just a TOML section in the config file — it does not write anything into the shell environment. It is only consulted when the corresponding direct field (`api_key` / `base_url`) is empty.

For the full list of credential key names, see [Environment variables: provider credential key names](./env-vars.md#provider-credential-key-names-written-in-configtoml).

## Command-line options

Options passed at startup have the highest priority and apply only to the current session:

| Option | Effect |
| --- | --- |
| `-S, --session [id]` | Resume a specific session; enters interactive selection when no id is given |
| `-C, --continue` | Resume the last session for the current working directory |
| `-y, --yolo` | Auto-approve regular tool calls; the agent may still ask questions |
| `--auto` | Start in auto permission mode: fully autonomous, the agent will not ask questions |
| `--plan` | Start in Plan mode |
| `-m, --model <model>` | Use a specific model alias for this session |
| `-p, --prompt <prompt>` | Run in non-interactive mode: execute a single prompt and exit |
| `--output-format <format>` | Output format for `-p` mode: `text` or `stream-json` |
| `--skills-dir <dir>` | Replace auto-discovered Skills directories (repeatable; applies to this session only) |

Mutual exclusion rules (startup fails if violated):

- `--output-format` can only be used with `-p`
- `--prompt` cannot be combined with `--yolo` or `--plan`
- `--continue` and `--session` cannot be used together
- In non-prompt mode, `--yolo` and `--plan` cannot be combined with `--continue` or `--session`

::: tip
`--skills-dir` is a one-shot replacement that only affects the current startup. To persistently add search directories, write `extra_skill_dirs` in `config.toml` (see [Agent Skills](../customization/skills.md)).
:::

## Common scenarios

**Isolated test environment** — use a separate data directory to avoid polluting the main config and sessions:

```sh
PYTHINKER_CODE_HOME="$PWD/.pythinker-sandbox" pythinker
```

**One-off test key** — keep the value in the shell and reference its name from the provider:

```toml
[providers.pythinker]
type = "pythinker"
api_key_env_var = "PYTHINKER_TEST_API_KEY"
```

```sh
export PYTHINKER_TEST_API_KEY=YOUR_API_KEY
```

**Skip approval for batch tasks**:

```sh
pythinker --yolo -p "Batch rename the following files..."
```

**Enter Plan mode temporarily** (to make it permanent, set `default_plan_mode = true` in the config file):

```sh
pythinker --plan
```

## Next steps

- [Configuration files](./config-files.md) — complete reference for all configurable fields
- [Environment variables](./env-vars.md) — full list and description of `PYTHINKER_CODE_HOME` and related variables
