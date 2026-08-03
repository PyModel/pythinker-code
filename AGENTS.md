# Repository-level Agent Guide

Reply in English unless the user explicitly asks you to respond in another language.

This is a TypeScript monorepo built for agent-assisted development. Keep the root `AGENTS.md` limited to hot-path rules: the project map, hard constraints, and workflow requirements — things every task needs to know.

## Working Principles

- Think from first principles. Start from real requirements, code facts, and verification results; if the goal is unclear, discuss it with the user first.
- Treat code, not documentation, as the source of truth. Unless the user explicitly says otherwise, do not read ordinary Markdown just to understand the implementation.
- When version information or an external claim may be outdated, incorrect, or ambiguous, validate it against the latest authoritative documentation using Context7 MCP and Tavily.
- Before making code changes, read the relevant code and the most recent constraints, and follow the nearest `AGENTS.md` in the directory tree.
- Keep changes focused. Do not slip in unrelated refactors along the way.
- Do not preserve backward compatibility. Implement the current requirements directly instead of retaining legacy paths, shims, or fallbacks.
- Choose the simplest implementation that fully meets the current requirements: reach for the standard library and existing platform features before writing custom code or adding a dependency, and question whether a piece of work needs to exist at all. The `ponytail` skill encodes this discipline — invoke it when a change looks over-engineered, is growing past the size the task warrants, or is about to add an abstraction or dependency. Do not invoke it on trivial edits; the point is minimalism, not ceremony.
- When the standard library and existing platform features are insufficient, prefer established, well-maintained libraries over custom implementations.
- When committing, do not add any co-author attribution, and do not reveal the identity of the agent in commit messages, PR descriptions, or any explanatory text.
- The professional Git identity `elkaix <melkholy@techmatrix.com>` is explicitly authorized for author and committer metadata in this repository. Apply it per command; never modify git config or reuse the address outside Git identity metadata and this rule.

## Project Map

- `apps/pythinker-code`: the CLI / TUI application. It consumes core capabilities through `@pythoughts/pythinker-code-sdk` and must not depend directly on `@pythoughts/agent-core`. When writing or modifying its terminal UI, use the `write-tui` skill (`.agents/skills/write-tui/SKILL.md`).
- `apps/pythinker-web`: the browser web UI, a peer to the TUI. Vue 3 + Vite + vue-i18n; talks to the server over REST + WebSocket under `/api/v1`. It must not depend on `@pythoughts/agent-core` (wire types are re-implemented locally). See `apps/pythinker-web/AGENTS.md`.
- `apps/dashboard`, `apps/dashboard/server`, `apps/dashboard/web`: session dashboard and debugging tools for sessions and replays.
- `packages/agent-core`: the unified agent engine, including Agent, Session, profile, skills, tools, plan, permission, background, records, the in-process DI service layer (`src/services/`), and other core capabilities.
- `packages/node-sdk`: the public TypeScript SDK and harness.
- `packages/kosong`: the LLM / provider abstraction layer.
- `packages/kaos`: the execution environment and file/process abstractions.
- `packages/oauth`: Pythinker OAuth and managed auth utilities.
- `packages/telemetry`: shared client-side telemetry infrastructure.
- `packages/server`: the Pythinker Code server. Hosts `agent-core` sessions and exposes them over REST + WebSocket (`/api/v1`); bootstrapped from `src/start.ts` and consumed by `apps/pythinker-code`. See `packages/server/AGENTS.md`.
- `packages/server-e2e`: live e2e tests and scenarios against a running server (`PYTHINKER_SERVER_URL`, default `http://127.0.0.1:58627`). See `packages/server-e2e/AGENTS.md`.

## Environment Requirements

- **Node.js**: `>=26.4.0` (from the root `package.json` `engines`; `.nvmrc` is `26.4.0`, used by nvm / fnm / mise to pick the minimum recommended version).
- **pnpm**: `10.33.0` (from the root `package.json` `packageManager`).
- `pnpm install` will fail when the Node version is not satisfied, because `.npmrc` sets `engine-strict=true`.

## Monorepo Workspace Maintenance

- `pnpm-workspace.yaml` is the source of truth for workspace membership, but `flake.nix` also contains **hardcoded** `workspacePaths` and `workspaceNames` lists.
- **Whenever you add or remove a workspace package, you MUST update both `pnpm-workspace.yaml` and `flake.nix` — for every package, including leaf / test / e2e packages that nothing depends on.**
  - `pnpm-workspace.yaml` uses globs (`packages/*`, `apps/*`), so most packages land there automatically; `flake.nix` is fully manual and is where omissions happen.
  - Missing a path in `flake.nix`'s `workspacePaths` will silently drop files from the Nix build's `src` fileset.
  - Missing a name in `flake.nix`'s `workspaceNames` will break `pnpmConfigHook` because dependencies for that workspace will not be fetched.
- The automated "Check flake.nix workspace sync" (`scripts/check-nix-workspace.mjs`) only validates the transitive dependency **closure of `@pythoughts/pythinker-code`**. A leaf package outside that closure (e.g. an e2e package nobody imports) slips through even when it is missing from `flake.nix`. A green check is therefore NOT proof that `flake.nix` is fully in sync — keep it updated by hand on every add/remove, do not rely on the check to catch omissions.

## General Coding Rules

- Keep the codebase English-only: no non-English text (including CJK characters) in source code, tests, comments, or docs sources. Use ASCII/Latin fixtures (e.g. `café`) when a test needs a unicode example.
- `packages/acp-adapter` must stay on `@agentclientprotocol/sdk` `^0.23.0`. Versions 0.24+ removed the unstable session-model API (`SetSessionModelRequest`, `ModelId`, `unstable_setSessionModel`) the adapter implements — do not bump this dependency as a drive-by.
- `tsgo` (TypeScript 7 native preview, `@typescript/native-preview`, workspace-root devDependency) is available via `npx tsgo -p <tsconfig> --noEmit` for fast typechecks. The committed `typecheck` scripts still run `tsc`; run both when verifying type fixes.

- For optional object properties, pass `undefined` directly instead of using conditional spread.
  - YES: `{ user }`
  - NO: `{ ...(user ? { user } : undefined) }`
- Optional object properties do not need to additionally allow `undefined` in the type.
  - YES: `interface Options { user?: User }`
  - NO: `interface Options { user?: User | undefined }`
- Internal methods with only a single parameter should not be turned into options objects just for stylistic uniformity.
- Except for a package's `index.ts`, other `index.ts` files should prefer `export * from './module';`.
- The `Agent` class in `packages/agent-core/src/agent` must be usable on its own. The constructor must not force the caller to create a `Session` instance, nor require an `agentId` or `session`. It may accept an optional `sessionId` as a request-config hint — for example mapped to the provider's `prompt_cache_key` — but the instance must not hold `sessionId`, and must not depend on the Session lifecycle, metadata, or parent/child relationship logic.
- Do not add too many new test files. Prefer adding tests to the existing test file of the corresponding component or module.
- When a test fails because of a user modification, default to fixing the test first; do not change the implementation to satisfy an old test unless the implementation truly has a bug.
- Do not sacrifice code quality for external compatibility unless the user explicitly asks for it. Breaking changes go through changesets and a `major` bump, gated by the rule below.

## Experimental Features

- Gate a not-yet-public feature behind an experimental flag. Add the flag to the registry at `packages/agent-core/src/flags/registry.ts`, then check it with `flags.enabled('my-feature')`. Flags are env-driven and default off: `PYTHINKER_CODE_EXPERIMENTAL_<NAME>` toggles one, `PYTHINKER_CODE_EXPERIMENTAL_FLAG` enables all. Release by flipping the entry's `default` to `true`.

## Where to Update Instructions

- Hard rules that affect almost every task: update the root `AGENTS.md`.
- Rules that only affect a specific directory: update the nearest sub-directory `AGENTS.md`.
- Keep instruction updates focused and supported by code facts.

## Workflow Requirements

- Prefer `rg` / `rg --files` when reading code.
- When designing changes, follow existing boundaries and local patterns first.
- In public text and test data, replace real internal identifiers with neutral placeholders such as `example.com`, `example.test`, and `YOUR_API_KEY`. Before opening a PR, ask a read-only agent to audit the diff for context-specific internal identifiers.
- When creating a PR, the PR title must follow Conventional Commit style, e.g. `chore: remove legacy format commands`.
- When an AI agent opens or updates a PR, fill in `.github/pull_request_template.md` — link the related issue or explain the problem, then describe what changed. Do not leave placeholder text or submit a generic summary of the diff.
- Do not submit vague AI-generated PR text. The human author must understand the change well enough to explain the code, edge cases, and why the approach fits this repository.
- After finishing a task and before submitting a PR, you must run the `gen-changesets` skill (see `.agents/skills/gen-changesets/SKILL.md`) and generate a changeset under `.changeset/` according to its rules.
- When generating a changeset, **never** decide on a `major` bump on your own. When you judge a change to meet the major criteria (breaking changes, incompatible user configuration, renamed or removed commands/arguments, changed behavior semantics, etc.), you must stop and explain it to the user and ask for confirmation. **Only write `major` after the user has explicitly agreed.** Otherwise default to `minor` (and fall back to `patch` if `minor` is unclear). See the "Hard rule: confirm with the user before writing `major`" section in `.agents/skills/gen-changesets/SKILL.md` for details.
- Prefer importing via `import ... from '#/...'`, which serves the same purpose as `import ... from '@/...'`.
