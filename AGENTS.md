# Repository-level Agent Guide

Reply in English unless the user explicitly asks otherwise. Always talk in ASD-STE100 Simplified Technical English.

TypeScript monorepo for **pythinker-code**, a provider-agnostic AI coding agent. This file covers product identity, project map, hard constraints, and workflow rules.

## Product Identity

**pythinker-code** plans, writes, tests, and iterates on code autonomously. The same runtime talks to any LLM through the `packages/kosong` abstraction layer.

### Wire Types

| Wire type          | SDK / transport         | Providers                                       |
| ------------------ | ----------------------- | ------------------------------------------------ |
| `anthropic`        | `@anthropic-ai/sdk`     | Anthropic (Claude family)                        |
| `openai`           | OpenAI Chat Completions | OpenAI (GPT-4o/4.1/4.5/5.x, GPT-3.5-turbo)     |
| `openai_responses` | OpenAI Responses API    | OpenAI (GPT-4.1/5.x, o-series)                  |
| `google-genai`     | `@google/genai`         | Google (Gemini 2.0–3.x)                          |
| `vertexai`         | Google Vertex AI        | Google Cloud–hosted Gemini                       |
| `pythinker`        | Pythinker managed API   | Any model proxied through Pythinker              |

Any OpenAI-compatible endpoint (DeepSeek, Qwen, GLM, Grok, Together AI, Fireworks, etc.) works via the `openai`/`openai_responses` wire with a custom `baseURL`.

### Model Selection

Flows through the **catalog** ([catalog.ts](packages/kosong/src/catalog.ts)):

1. JSON catalog maps `providerId → models[]` with context window, capabilities, cost, and modality metadata.
2. `inferWireType()` resolves provider → wire type (explicit `type` field, then heuristic on `npm`/`id`).
3. `createProvider()` instantiates the correct `ChatProvider`.
4. `getModelCapability()` returns per-model flags (vision, tool-use, thinking, fast-mode).

Adding an OpenAI-compatible provider requires **zero code changes** — just add a catalog entry.

## Working Principles

- Start from requirements and code facts; discuss unclear goals first.
- Code is the source of truth — don't read Markdown to understand implementation.
- Validate version claims against authoritative docs (Context7 MCP, Tavily).
- Read relevant source and follow the nearest `AGENTS.md` before changing code.
- Keep changes focused — no drive-by refactors.
- Implement current requirements directly; no backward-compatibility shims.
- Simplest implementation first: stdlib → established libraries → custom code.
- No co-author attribution or agent identity in commits/PRs.
- Git identity: `elkaix <melkholy@techmatrix.com>` — apply per command; never modify git config.

## Project Map

| Package | Description | Notes |
| ------- | ----------- | ----- |
| `apps/pythinker-code` | CLI / TUI app | Consumes `@pymodel/pythinker-code-sdk`; no `agent-core` dep. Use `write-tui` skill. |
| `apps/pythinker-web` | Browser UI (Vue 3 + Vite + vue-i18n) | REST + WS `/api/v1`; no `agent-core` dep. See its `AGENTS.md`. |
| `apps/pythinker-inspect` | Web inspector for the kap-server `/api/v1/debug` RPC surface | Workspace/session browser, per-session transcript chat, per-scope Service panels, DI unit inspection. See its `AGENTS.md`. |
| `apps/vis` | Session replay & debugging visualizer | `server/` + `web/` subdirs. |
| `packages/agent-core` | Agent engine | Agent, Session, profile, skills, tools, plan, permission, DI. |
| `packages/agent-core-v2` | DI × Scope agent engine (the v2 port behind kap-server) | Four `LifecycleScope` tiers — `App` / `Workspace` / `Session` / `Agent` (`app/scopes.ts`) — plus the L3 unit layer (`Service`/`Fiber` units, collection contribution points, the Feature seam in `src/features/`). See its `AGENTS.md` and use the `agent-core-dev` skill. |
| `packages/node-sdk` | Public TS SDK & harness | |
| `packages/kosong` | LLM provider abstraction | Wire types, catalog, capability registry. |
| `packages/kaos` | Execution environment | File/process abstractions. |
| `packages/kap-server` | Pythinker Code server | Backed by `@pymodel/agent-core-v2`; sessions over REST + WebSocket (`/api/v1` + `/api/v1/ws`), plus `/api/v1/debug/*` reflection RPC (`--debug-endpoints`, loopback bind + bearer auth). See its `AGENTS.md`. |
| `packages/klient` | Client SDK | Contract-driven facade over agent-core-v2 (`global.*` / `session(id).*` / `agent(id).*`, zod-validated); transport via subpath entry (`@pymodel/klient/ipc|memory`); hosts the e2e suites. See its `AGENTS.md`. |
| `packages/transcript` | Isomorphic transcript rendering data layer | L1 agent-granular store, L2 idempotent operations, L3 `off/turn/block/delta` subscription granularity, L4 framework-free view registry, turn-cursor pagination. Pure TypeScript (browser-safe, no engine imports); sole owner of the transcript contract types (`src/contract/`). See its `AGENTS.md`. |
| `packages/oauth` | Auth utilities | |
| `packages/telemetry` | Client-side telemetry | |
| `packages/tree-sitter-bash` | Pure-TypeScript bash parser | No runtime deps, no wasm; `parse(source, { timeoutMs, maxNodes })` under a deterministic budget returns a discriminated `ParseResult` — treat aborted/hasError trees as "cannot analyze" and degrade. Parser only, no safety judgments. |
| `packages/minidb` | Embedded JSON document store | `MiniDb` behind kap-server's search index — snapshot + WAL persistence with an exclusive write lock, larger-than-RAM full-text layer, persistent index generations. See its `AGENTS.md`. |

The web bundle: `apps/pythinker-code/dist-web` is the committed, prebuilt bundle of `apps/pythinker-web` (built with `pnpm --filter @pymodel/pythinker-web run build` and copied via `scripts/copy-web-assets.mjs`). `apps/pythinker-code/scripts/check-web-assets.mjs` guards packaging against a missing bundle — sync and commit the bundle in the same change whenever the web UI should ship differently.

## Environment

- **Node.js** ≥ 26.4.0 (`.nvmrc`). **pnpm** 10.34.3 (root `packageManager`). `engine-strict=true`; `pnpm install` fails when the Node version is not satisfied.

## Monorepo Maintenance

- `pnpm-workspace.yaml` is source of truth, but `flake.nix` **hardcodes** `workspacePaths`/`workspaceNames`.
- **Update both** when adding/removing any workspace package — for every package, including leaf / test / e2e packages that nothing depends on. Missing a path silently drops files from Nix's `src` fileset; missing a name breaks `pnpmConfigHook` (dependencies for that workspace are not fetched).
- CI (`scripts/check-nix-workspace.mjs`) only validates the transitive dependency **closure of `@pymodel/pythinker-code`** — a leaf package outside that closure slips through even when missing from `flake.nix`. A green check is NOT proof of full sync — keep `flake.nix` updated by hand.

## Coding Rules

- English-only codebase. Use ASCII/Latin fixtures (e.g. `café`) for unicode tests.
- `packages/agent-core-v2`, `packages/kap-server`, and `packages/transcript` are comment-free zones: no line/block comments; exceptions are JSDoc attached to exported symbols and load-bearing lint-suppression directives (`oxlint-disable` / `eslint-disable`), while other tooling directives (`@ts-expect-error`, …) stay banned. Enforced by `scripts/check-no-comments.mjs`, which runs as part of `pnpm lint`.
- `packages/acp-adapter`: pin `@agentclientprotocol/sdk` `^0.23.0` (0.24+ broke session-model API).
- `tsgo` (`@typescript/native-preview`) available via `npx tsgo -p <tsconfig> --noEmit`; committed scripts use `tsc` — run both for type fixes.
- Pass `undefined` directly for optional props — no conditional spread.
- `user?: User`, not `user?: User | undefined`.
- Single-param internal methods stay single-param — no options-object wrapping.
- Non-root `index.ts`: prefer `export * from './module'`.
- `Agent` class must be standalone — no mandatory `Session`/`agentId`. Optional `sessionId` as provider hint only.
- Prefer adding tests to existing files. Fix failing tests first (unless there's a real impl bug); when a test fails because of a user modification, default to fixing the test first, not the implementation.
- Do not sacrifice code quality for external compatibility unless the user explicitly asks for it.
- Breaking changes require changesets with `major` bump (user confirmation required).

## Experimental Features

Gate behind flags. Env: `PYTHINKER_CODE_EXPERIMENTAL_<NAME>` toggles one; `PYTHINKER_CODE_EXPERIMENTAL_FLAG` enables all. Release: flip the entry's `default` to `true`.

- `packages/agent-core` (v1): add the flag to the central registry at `packages/agent-core/src/flags/registry.ts`, then check it with `flags.enabled('my-feature')`.
- `packages/agent-core-v2` and kap-server modules: no central catalog — declare the flag in the owning domain via `registerFlagDefinition` at import time (see `packages/agent-core-v2/docs/flag.md`), then check it with `IFlagService.enabled(id)`.

## Workflow

- **Never commit to `main` directly.** Every change lands through a pull request: branch, push the
  branch, open a PR, get the checks green, then merge. `main` enforces this for everyone including
  admins, so a direct push is rejected outright (`GH006`) — do not try to work around it with
  `--admin`, `--no-verify`, or a force push.
- A PR is mergeable only when all six required checks pass (`build`, `test`, `lint`, `typecheck`,
  `nix build .#pythinker-code`, `Check flake.nix workspace sync`), every review conversation is
  resolved, and the branch is up to date with `main`.
- Prefer `rg` / `rg --files` for code reading.
- Follow existing boundaries and local patterns.
- Replace internal identifiers with neutral placeholders in public text/test data (e.g. `example.com`, `example.test`, `YOUR_API_KEY`). Before opening a PR, ask a read-only agent to audit the diff for context-specific internal identifiers.
- PR titles: Conventional Commit style (e.g. `chore: remove legacy format commands`).
- Fill in `.github/pull_request_template.md` — link the issue, describe changes. No placeholder text or vague AI-generated PR summaries; the human author must understand the change well enough to explain the code, edge cases, and why the approach fits.
- Run `gen-changesets` skill before submitting PRs. Changesets must strictly follow its rules: one short user-facing sentence stating only what changed; skip any change users cannot perceive. Never decide `major` on your own — stop, explain, and get explicit user confirmation first; default to `minor`, fall back to `patch`.
- Prefer `import ... from '#/...'` (equivalent to `@/...`).
- Do not commit throwaway scratch or exploratory files. Never stage agent working notes or handoff documents (e.g. `HANDOVER-*.md`, `HANDOFF-*.md`, `handoff.md`), or throwaway UI/UX prototypes or design mockups (e.g. `*-designs.html`, `*-mockup.html`, `*-demo(s).html`). The only tracked `.html` files should be Vite `index.html` entrypoints. Put scratch work under `.tmp/` (gitignored).

## Where to Update Instructions

- Hard rules that affect almost every task: update the root `AGENTS.md`.
- Rules that only affect a specific directory: update the nearest sub-directory `AGENTS.md`.
- Project-map entries stay at 1–2 sentences; deep package docs live in the package's own `AGENTS.md`.
