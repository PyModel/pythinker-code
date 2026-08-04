# Repository-level Agent Guide

Reply in English unless the user explicitly asks you to respond in another language.

This is a TypeScript monorepo for **pythinker-code**, a multi-provider AI coding agent. Keep the root `AGENTS.md` limited to hot-path rules: product identity, project map, hard constraints, and workflow requirements.

## Product Identity

**pythinker-code** is an agentic coding assistant that plans, writes, tests, and iterates on code autonomously. Its defining trait is **provider-agnostic model selection**: the same agent runtime talks to any supported LLM through the `packages/kosong` abstraction layer.

### Supported Wire Types

| Wire type          | SDK / transport         | Native providers                                                               |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------ |
| `anthropic`        | `@anthropic-ai/sdk`     | Anthropic (Claude 3 / 3.5 / 3.7 / Opus 4–5 / Sonnet 4–5 / Haiku 4.5 / Fable 5) |
| `openai`           | OpenAI Chat Completions | OpenAI (GPT-4o, GPT-4.1, GPT-4.5, GPT-5.4–5.6 Sol/Terra/Luna, GPT-3.5-turbo)   |
| `openai_responses` | OpenAI Responses API    | OpenAI (GPT-4.1, GPT-5.6 Sol/Terra/Luna, o1, o3, o3-pro, o4-mini)              |
| `google-genai`     | `@google/genai`         | Google (Gemini 2.0 / 2.5 Pro & Flash; 3.x via catalog)                         |
| `vertexai`         | Google Vertex AI        | Google Cloud–hosted Gemini models                                              |
| `pythinker`        | Pythinker managed API   | Any model proxied through Pythinker's own endpoint                             |

### OpenAI-Compatible Providers

Any provider exposing an OpenAI-compatible `/chat/completions` or `/v1` endpoint can be used through the `openai` or `openai_responses` wire type with a custom `baseURL`. This includes — but is not limited to:

- **DeepSeek** (DeepSeek-V4-Pro, DeepSeek-V4-Flash, DeepSeek-R1)
- **Alibaba Qwen** (Qwen3.8-Max, Qwen3.7, Qwen3-Coder)
- **Zhipu GLM** (GLM-5.2, GLM-5.1)
- **MiniMax** (MiniMax M3)
- **Moonshot / Kimi** (Kimi K3)
- **xAI Grok** (Grok 4.5, Grok 4.3), **Together AI**, **Fireworks**, **Perplexity**, and other OpenAI-compatible hosts

### Model Selection

Model selection flows through the **catalog system** (`packages/kosong/src/catalog.ts`):

1. An external `models.dev`-style JSON catalog maps `providerId → models[]`, each with context window, capabilities, cost rates, and modality metadata.
2. `inferWireType()` resolves a catalog provider to its wire type — explicit `type` field first, then heuristic matching on `npm`/`id`.
3. `createProvider()` instantiates the correct `ChatProvider` implementation for the resolved wire.
4. Capability lookups (`getModelCapability()`) return vision, tool-use, thinking, and fast-mode flags per model, enabling the agent runtime to adapt prompting strategy to each model's strengths.

Adding a new provider requires **zero code changes** when it is OpenAI-compatible — just add the entry to the catalog JSON.

## Working Principles

- Think from first principles; start from requirements, code facts, and verification — discuss unclear goals with the user first.
- Treat code as the source of truth. Do not read Markdown to understand implementation unless the user says otherwise.
- Validate outdated or ambiguous version claims against authoritative docs using Context7 MCP and Tavily.
- Before changing code, read the relevant source and follow the nearest `AGENTS.md` in the directory tree.
- Keep changes focused — no drive-by refactors.
- Do not preserve backward compatibility; implement current requirements directly without legacy shims.
- Choose the simplest implementation: standard library and platform features first, then established libraries, then custom code. Use the `ponytail` skill when a change looks over-engineered (skip it on trivial edits).
- Do not add co-author attribution or reveal agent identity in commits, PRs, or explanatory text.
- Git identity: `elkaix <melkholy@techmatrix.com>` — apply per command; never modify git config or reuse the address elsewhere.

## Project Map

- `apps/pythinker-code` — CLI / TUI app. Consumes `@pythoughts/pythinker-code-sdk`; must not depend on `@pythoughts/agent-core`. Use the `write-tui` skill for TUI changes.
- `apps/pythinker-web` — Browser UI (Vue 3 + Vite + vue-i18n). REST + WebSocket under `/api/v1`; must not depend on `@pythoughts/agent-core`. See `apps/pythinker-web/AGENTS.md`.
- `apps/dashboard` (`server/`, `web/`) — Session dashboard and replay tools.
- `packages/agent-core` — Unified agent engine: Agent, Session, profile, skills, tools, plan, permission, background, records, DI services.
- `packages/node-sdk` — Public TypeScript SDK and harness.
- `packages/kosong` — LLM provider abstraction layer (wire types, catalog, capability registry).
- `packages/kaos` — Execution environment, file/process abstractions.
- `packages/oauth` — Pythinker OAuth and managed auth utilities.
- `packages/telemetry` — Shared client-side telemetry.
- `packages/server` — Pythinker Code server; hosts `agent-core` sessions over REST + WebSocket (`/api/v1`). See `packages/server/AGENTS.md`.
- `packages/server-e2e` — Live e2e tests against a running server (`PYTHINKER_SERVER_URL`, default `http://127.0.0.1:58627`). See `packages/server-e2e/AGENTS.md`.

## Environment

- **Node.js** `>=26.4.0` (`.nvmrc` is `26.4.0`). **pnpm** `10.33.0` (root `packageManager`).
- `pnpm install` enforces the Node version (`engine-strict=true` in `.npmrc`).

## Monorepo Workspace Maintenance

- `pnpm-workspace.yaml` is the source of truth, but `flake.nix` has **hardcoded** `workspacePaths` and `workspaceNames`.
- **When adding or removing any workspace package, update both `pnpm-workspace.yaml` and `flake.nix`** — even leaf/test/e2e packages. Missing a path silently drops files from the Nix build; missing a name breaks `pnpmConfigHook`.
- The CI check (`scripts/check-nix-workspace.mjs`) only validates the transitive closure of `@pythoughts/pythinker-code` — leaf packages outside that closure can slip through. Keep `flake.nix` updated by hand.

## Coding Rules

- English-only codebase: no non-English text in source, tests, comments, or docs. Use ASCII/Latin fixtures (e.g. `café`) for unicode tests.
- `packages/acp-adapter` must stay on `@agentclientprotocol/sdk` `^0.23.0` — 0.24+ removed the unstable session-model API it implements.
- `tsgo` (`@typescript/native-preview`) is available via `npx tsgo -p <tsconfig> --noEmit` for fast typechecks; committed `typecheck` scripts still run `tsc` — run both when verifying type fixes.
- For optional object properties, pass `undefined` directly — not conditional spread (`{ ...(x ? { x } : undefined) }`).
- Optional properties do not need `| undefined` in the type (`user?: User`, not `user?: User | undefined`).
- Single-parameter internal methods stay as single parameters — do not wrap in an options object.
- Non-root `index.ts` files should prefer `export * from './module'`.
- The `Agent` class (`packages/agent-core/src/agent`) must be standalone: no mandatory `Session`, `agentId`, or `session`. It may accept an optional `sessionId` as a provider hint but must not hold it or depend on Session lifecycle.
- Prefer adding tests to existing test files over creating new ones.
- When a test fails after a user modification, fix the test first unless the implementation has a real bug.
- Do not sacrifice code quality for compatibility. Breaking changes go through changesets with a `major` bump (user confirmation required).

## Experimental Features

Gate unreleased features behind flags in `packages/agent-core/src/flags/registry.ts`. Check with `flags.enabled('my-feature')`. Env-driven: `PYTHINKER_CODE_EXPERIMENTAL_<NAME>` toggles one; `PYTHINKER_CODE_EXPERIMENTAL_FLAG` enables all. Release by flipping `default` to `true`.

## Where to Update Instructions

- Hot-path rules affecting all tasks → root `AGENTS.md`. Directory-specific rules → nearest sub-directory `AGENTS.md`. Keep updates focused and code-backed.

## Workflow

- Prefer `rg` / `rg --files` for code reading.
- Follow existing boundaries and local patterns when designing changes.
- Replace internal identifiers with neutral placeholders (`example.com`, `example.test`, `YOUR_API_KEY`) in public text and test data. Before opening a PR, audit the diff for leaked identifiers.
- PR titles follow Conventional Commit style (e.g. `chore: remove legacy format commands`).
- When an AI agent opens/updates a PR, fill in `.github/pull_request_template.md` — link the issue, describe what changed. No placeholder text or vague AI-generated summaries.
- Before submitting a PR, run the `gen-changesets` skill and generate a changeset under `.changeset/`. **Never decide a `major` bump on your own** — explain the breaking change to the user and get explicit confirmation first; default to `minor` (or `patch` if unclear).
- Prefer `import ... from '#/...'` (equivalent to `@/...`).
