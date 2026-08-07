# Providers and models

Pythinker Code CLI supports connecting to multiple LLM platforms simultaneously — one-click login via the Pythinker Code managed service, connecting Claude with an Anthropic API key, or connecting third-party inference services via the OpenAI-compatible protocol. Each provider corresponds to a specific API protocol; models are declared on top of providers with their own name, context length, and capabilities. This page explains how to configure each type of provider in `config.toml`.

## Supported provider types

The `type` field in the `providers` table determines which protocol implementation to use:

| Type | Protocol | Typical use |
| --- | --- | --- |
| `pythinker` | OpenAI-compatible | Pythinker Code managed service, Pythinker Platform API key |
| `anthropic` | Anthropic Messages | Claude model family |
| `openai` | OpenAI Chat Completions | OpenAI and compatible services, DeepSeek, Qwen, etc. |
| `openai_responses` | OpenAI Responses API | OpenAI's newer Responses interface |
| `google-genai` | Google GenAI | Gemini API |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI |

All providers communicate with models in streaming mode by default. Capabilities such as thinking, vision, and tool use are matched automatically by model name prefix — you typically do not need to declare them manually.

**Credential priority**: `api_key` direct field > the shell variable named by `api_key_env_var` > `[providers.<name>.env]` sub-table key > if all are absent, startup fails with an error. Shell variables are never guessed: a provider must name one with `api_key_env_var`. See [Config overrides: provider credentials](./overrides.md#provider-credentials).

## `/provider` — interactive provider management

Prefer not to edit TOML by hand? Type `/provider` in the TUI to open the **provider manager**, where you can interactively add or remove providers.

The manager displays providers as a list of entries grouped by source. Navigation:

- ↑/↓ to move the cursor, ←/→ to page
- `d` to delete the current provider (with `[y/N]` confirmation)
- Press Enter on the `[ Add New Platform ]` row to add a new provider

Two paths when adding:

- **Known third-party provider**: fetches the model catalog from [models.dev](https://models.dev/), validates the catalog-declared credential variable from the shell, then lets you select a default model. Set the variable before starting the TUI; the token is not written to `config.toml`.
- **Custom registry (api.json)**: paste a custom registry URL and Bearer token; the CLI automatically creates the `providers` / `models` entries. On later startup, providers from the same registry URL are refreshed together, so upstream provider additions, removals, and model metadata changes are synced.

The same operations are also available in non-interactive environments via the shell command: [`pythinker provider`](../reference/pythinker-command.md#pythinker-provider).

## Catalog-backed API and coding-plan providers

Catalog-backed setup uses live provider, endpoint, model, capability, and context-limit metadata from [models.dev](https://models.dev/). Set the provider-issued API key or coding-plan token in the shell, then import the catalog entry:

```sh
export DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY
pythinker provider catalog add deepseek

export ZHIPU_API_KEY=YOUR_ZHIPU_API_KEY
pythinker provider catalog add zai-coding-plan

export MINIMAX_API_KEY=YOUR_MINIMAX_API_KEY
pythinker provider catalog add minimax-coding-plan

export KIMI_API_KEY=YOUR_KIMI_API_KEY
pythinker provider catalog add kimi-for-coding
```

The repository's `.env.example` lists these placeholder names, but Pythinker Code does not load `.env` files automatically. Export the values or provide them through your shell, CI, or secret manager before running the command or opening the TUI.

Catalog import stores only the environment-variable name. A DeepSeek import, for example, produces this provider shape plus live model aliases:

```toml
[providers.deepseek]
type = "openai"
base_url = "https://api.deepseek.com"
api_key_env_var = "DEEPSEEK_API_KEY"
source = { kind = "modelsDev", url = "https://models.dev/api.json" }
```

DeepSeek and GLM Coding Plan use the existing OpenAI-compatible adapter. MiniMax Token Plan and Kimi For Coding use the existing Anthropic-compatible adapter. Catalog refresh updates catalog-derived model metadata while retaining `api_key_env_var` and user selections. Models, limits, and reasoning controls can change upstream, so `pythinker provider catalog list <providerId>` is authoritative at setup time. Plan quotas and rate limits remain enforced by the upstream provider; Pythinker Code does not predict or enforce subscription allowance locally.

### How to add another catalog provider

1. Run `pythinker provider catalog list --filter <name>` and inspect the provider with `pythinker provider catalog list <providerId>`.
2. Set the first credential variable declared by that catalog entry. To use a different variable name, pass `--api-key-env <name>`.
3. Run `pythinker provider catalog add <providerId>`, optionally with `--default-model <modelId>`.

Compatible providers need no provider-specific class: the catalog selects an existing wire adapter and supplies the endpoint and model metadata. Providers that require extra account fields or an unsupported transport are rejected instead of being guessed.

## `pythinker`

For connecting to Pythoughts's OpenAI-compatible interface, including the Pythinker Code managed service and Pythinker Platform API keys.

- Default `base_url`: `https://api.pythoughts.ai/v1`
- Credential key names: `PYTHINKER_API_KEY`, `PYTHINKER_BASE_URL`
- Additional capability: supports video upload

```toml
[providers.pythinker]
type = "pythinker"
base_url = "https://api.pythoughts.ai/v1"
api_key = "sk-xxxxx"
```

> When using the Pythinker Code managed service, running `/login` automatically configures `base_url` and credentials — no manual setup needed.

## `anthropic`

For connecting to the Claude API. Standard Claude models automatically enable vision, tool use, and Thinking (where supported); custom or uncovered models need `capabilities` declared explicitly on `[models.<alias>]`.

- Default `base_url`: follows Anthropic SDK default
- Credential key names: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
- Default `max_tokens`: inferred per model. To override, set `max_output_size` on the model alias

```toml
[providers.anthropic]
type = "anthropic"
api_key = "sk-ant-xxxxx"

[models."claude-opus-4-7"]
provider = "anthropic"
model = "claude-opus-4-7"
max_context_size = 200000
# max_output_size = 32000  # optional; omit to use the model-inferred default
```

## `openai`

For connecting to the OpenAI Chat Completions protocol, as well as any third-party service compatible with that protocol (override `base_url` as needed).

Third-party reasoning models (DeepSeek, Qwen, One API, etc.) work out of the box: the CLI automatically handles the `reasoning_content` field and `reasoning_effort` injection. If your gateway returns reasoning content under a non-standard field name, set `reasoning_key` on the model alias to override.

- Default `base_url`: `https://api.openai.com/v1`
- Credential key names: `OPENAI_API_KEY`, `OPENAI_BASE_URL`

```toml
[providers.openai]
type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `openai_responses`

Corresponds to OpenAI's newer Responses API, always operating in streaming mode. Configuration is the same as `openai`.

- Default `base_url`: `https://api.openai.com/v1`
- Credential key names: `OPENAI_API_KEY`, `OPENAI_BASE_URL`

```toml
[providers.openai-responses]
type = "openai_responses"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `google-genai`

For connecting directly to the Google Gemini API. Thinking, vision, and multimodal capabilities are auto-detected by model name.

- Credential key name: `GOOGLE_API_KEY`

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
```

## `vertexai`

Shares the same implementation as `google-genai`; setting `type = "vertexai"` switches to the Vertex AI access path.

Authentication follows the standard Google Cloud ADC flow (`gcloud auth application-default login` or a `GOOGLE_APPLICATION_CREDENTIALS` service account JSON) — this part is unrelated to Pythinker Code. **The project ID and region must be written in the `[providers.vertexai.env]` sub-table** — simply `export GOOGLE_CLOUD_PROJECT` in the shell will not be read by the CLI.

```toml
[providers.vertexai]
type = "vertexai"

[providers.vertexai.env]
GOOGLE_CLOUD_PROJECT = "my-gcp-project"
GOOGLE_CLOUD_LOCATION = "us-central1"
```

```sh
gcloud auth application-default login   # one-time authentication
pythinker
```

## OAuth

OpenAI Codex is the one provider that authenticates with OAuth rather than a static API key. `/login` runs the browser flow and writes the resulting credentials into `config.toml` — no manual configuration is needed. Every other provider uses an API key.

## Next steps

- [Configuration files](./config-files.md) — full field reference for the `providers` and `models` tables
- [Config overrides](./overrides.md) — credential resolution priority rules for providers
- [Environment variables](./env-vars.md) — credential key names per provider type
