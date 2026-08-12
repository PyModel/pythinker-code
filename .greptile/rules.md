# Review Rules

## TypeScript conventions

- `user?: User`, never `user?: User | undefined`.
- Pass `undefined` directly for optional props — no conditional spread.
- Single-param internal methods stay single-param — no options-object wrapping.
- Non-root `index.ts` files: prefer `export * from './module'`.
- Prefer `import ... from '#/...'` over deep relative paths (equivalent to `@/...`).

## Architecture boundaries

- `apps/pythinker-code` and `apps/pythinker-web` must not depend on `packages/agent-core`. They consume the SDK (`@pythoughts/pythinker-code-sdk`) or the server REST/WS API.
- The `Agent` class in `packages/agent-core` stays standalone: no mandatory `Session` or `agentId`; optional `sessionId` is a provider hint only.
- `packages/acp-adapter` pins `@agentclientprotocol/sdk` to `^0.23.0` — flag any bump to 0.24+ (it broke the session-model API).
- Experimental features are gated behind flags in `packages/agent-core/src/flags/registry.ts`, not shipped unguarded.

## Hygiene

- English-only code, comments, and identifiers. Unicode tests use ASCII/Latin fixtures (e.g. `café`).
- No backward-compatibility shims; implement the current requirement directly.
- Prefer adding tests to existing test files over creating new ones.
- Internal identifiers must not appear in public text or test data — use neutral placeholders.
