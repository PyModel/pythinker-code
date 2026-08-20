# pythinker-web Agent Guide

Package-local rules for `apps/pythinker-web` (`@pymodel/pythinker-web`).

## What it is

The browser web UI for Pythinker Code — a peer to the TUI in `apps/pythinker-code`. It talks to the local server over REST + WebSocket under `/api/v1`. Stack: Vue 3 + Vite 6 + TypeScript (strict) + vue-i18n v11. (Tailwind was removed; all styling is via design tokens in `src/style.css` + scoped component styles.) There is no client router and no Pinia; state lives in composables/refs and provide/inject.

## Design system (normative — required when modifying the UI)

- **Before changing any component, style, layout, or theme, read the design system view at `src/views/DesignSystemView.vue` (open it as an overlay: long-press the sidebar logo).** It is the canonical design system and visual spec for this app (tokens §02, primitives §03, chat §04, theme rules §05, style rules §06). It consumes the product tokens from `src/style.css` directly, so it stays in sync with the app. New and modified UI must match it.
- **Use the primitives in `src/components/ui/`.** The library covers Button, IconButton, Badge, Pill, Card, Input/Select/Textarea/Field, Dialog, Spinner, ThinkingIndicator, Link, Menu/MenuItem, SegmentedControl, Tabs, Switch, Checkbox, Avatar, EmptyState, Divider, Tooltip, Banner, Sheet, Skeleton, CommandBar, TopBar. One semantic = one component — do not hand-roll a bespoke button/badge/dialog/input for a single screen. When a primitive replaces an element, **delete the old scoped CSS** (do not append override blocks).
- **Use the tokens, not ad-hoc values.** Colors, fonts, radii, spacing, shadows, z-index, and motion come from the CSS custom properties in `src/style.css` (catalogued in the design-system view §02). Canonical names are `--color-*` / `--radius-*` / `--space-*` / `--text-*` / `--font-*` / `--z-*` / `--shadow-*` / `--ease-*` / `--duration-*` / `--weight-*` / `--leading-*`. A small set of layout/focus tokens keep the `--p-` prefix: `--p-focus-ring`, `--p-selection`, `--p-ic-sm/md/lg`, `--p-sidebar-w`, `--p-content-max/-wide`, `--p-bp-sm/-md`.
- **The Braille thinking indicator (`⣷`) is reserved** for the chat "waiting for the agent's first response" state only, and is rendered solely by `ui/ThinkingIndicator.vue`; every other loading state uses the plain `Spinner`.
- **Run `pnpm --filter @pymodel/pythinker-web check:style`** (`scripts/check-style.mjs`) — it enforces the §06 anti-pattern rules (no-gradient, no-glassmorphism except TopBar `frost`, no-emoji-icon, no-hardcoded-hex/font, radius/z/weight from scale). Do not add new violations.
- **Verify visually.** For any UI change, render it in the browser (light + dark, plus hover/focus states) and confirm it matches the design-system view and introduces no regression before considering it done. Build/typecheck/check-style are necessary but not sufficient.

## Layout (`src/`)

- `main.ts` — bootstrap (creates the app, installs i18n, mounts `#app`). `App.vue` — root component, holds most app state.
- `api/` — server client. `index.ts` exposes the `getPythinkerWebApi()` singleton; `config.ts` builds REST/WS URLs; `daemon/` holds the wire client (`http.ts`, `ws.ts`, `wire.ts`, `mappers.ts`, `agentEventProjector.ts`, `eventReducer.ts`).
- `components/` — SFCs grouped by area: `chat/` (conversation/chat UI), `settings/` (settings & configuration), `dialogs/` (modal dialogs & sheets), `mobile/` (mobile-specific shell), `ui/` (design-system primitives — see "Design system" above), plus shared layout components at the top level.
- `composables/` — reusable state logic, `useX` naming (`usePythinkerWebClient`, `useIsDark`, `usePaneLayout`, …).
- `lib/` — pure helpers (`parseDiff`, `slashCommands`, `sessionRoute`, `toolMeta`, …).
- `i18n/` — vue-i18n setup plus locale namespaces.
- `debug/` — `DebugPanel.vue` and `trace.ts` for client error/trace capture.

## Vue conventions (normative)

- SFCs use **`<script setup lang="ts">`** + the Composition API. Component files are **PascalCase** (`ChatHeader.vue`).
- Type props with the generic form `defineProps<{ ... }>()`; type emits with `defineEmits<{ evt: [arg: Type] }>()`.
- Shared components go in `src/components/`; reusable logic goes in `src/composables/` with a `use` prefix.
- There is **no auto-import plugin** and **no path alias** — `#/` and `@/` are intentionally unused. Write relative imports (`../i18n`, `./config`).

## i18n (normative — the app is English-only)

- Setup: `src/i18n/index.ts`, vue-i18n in Composition mode (`legacy: false`), fallback `en`. The active locale is persisted in `localStorage` under `pythinker-locale`.
- **`en` is the only locale.** `src/i18n/locales/` contains exactly one directory, and `locales/index.ts` registers only `en`. Do not add a second locale, and do not "restore parity" with one that does not exist.
- Locale files: `src/i18n/locales/en/<namespace>.ts`, each `export default { ... } as const`. New namespaces are registered in `src/i18n/locales/index.ts`.
- Reference with `const { t } = useI18n()` and `t('namespace.key')` (same form in templates).
- **Adding a key:** add it to `en/<ns>.ts`. **Adding a namespace:** create the file under `en/` **and** register it in `locales/index.ts`.

## Commands

All via `pnpm --filter @pymodel/pythinker-web …`:

- `dev` — Vite dev server (port `WEB_PORT`, default 5175; proxies `/api/v1` to `PYTHINKER_SERVER_URL`, default `http://127.0.0.1:58627`).
- `build` — production build into `dist/`.
- `typecheck` — `vue-tsc --noEmit`.
- `test` — `vitest run` (pure logic tests only; no jsdom / component tests).
- `check:style` — design-system §06 anti-pattern guard (`scripts/check-style.mjs`).
- There is **no `lint` script** in this package; linting runs at the repo root via oxlint.

Debugging against agent-gateway instances: start one from the repo root with `pnpm dev:server` (port 58627), optionally a second with `pnpm dev:v2` (port 58628 — instances share the home dir via the registry, so both can run at once). The dev server proxies `/api/v1` to the `default` preset; the Sidebar brand row carries a dev-only backend pill (engine generation `v1`/`v2` from `GET /api/v1/meta`'s `backend` field + endpoint) whose menu repoints the proxy at runtime — no Vite restart. Presets default to `http://127.0.0.1:58627` / `:58628`, overridable via `PYTHINKER_BACKEND_DEFAULT_URL` / `PYTHINKER_BACKEND_MULTI_URL`; the switcher endpoints (`GET/POST /__pythinker-dev/backend`, dev-only, see `backendSwitcherPlugin` in `vite.config.ts`) drive the menu.

## Gotchas / hard rules

- **Do not depend on `@pymodel/agent-core`** (mirrors the CLI/SDK rule). The web app is decoupled from core/protocol; wire types are re-implemented locally in `src/api/daemon/wire.ts`. Keep it that way.
- **Same-origin by default:** the browser only talks to its own origin; Vite proxies `/api/v1` for both HTTP and WS. Set `VITE_PYTHINKER_SERVER_HTTP_URL` only when you intentionally want direct (CORS) mode.
- Vite-injected globals (`__PYTHINKER_DEV_PROXY_TARGET__`, `__PYTHINKER_DEV_BACKENDS__`, `__PYTHINKER_WEB_VERSION__`, `__PYTHINKER_WEB_COMMIT__`) are declared in `src/env.d.ts` and defined in `vite.config.ts`. Do not hand-edit `dist/`.
- **Theming:** the root element carries `data-color-scheme` (`light` | `dark` | `system`); react to it through `useIsDark()`, not by reading the DOM directly.
- Keep the Vite **dev** proxy and **`preview`** proxy in sync — both are defined in `vite.config.ts` (shared `apiProxyOptions`).
- The shared proxy strips the browser `Origin` header on forwarded requests: `changeOrigin` rewrites `Host` to the server but leaves `Origin` pointing at the Vite origin, and agent-gateway's WS upgrade path rejects that mismatch with 403. An Origin-less request is treated as a non-browser client. If you add another proxied path, route it through the same options.
- **Upstream design parity:** the upstream removed its web UI source (2026-08-05); its current design exists only compiled in the reference checkout's `dist-web` bundle (`blackbox/refrence/apps/*/dist-web`, primary checkout only — gitignored). The last full upstream web source, already rebranded, is vendor commit `f12110e95` (`vendor/upstream`). When porting design, extract from the compiled bundle (component render fns + scoped CSS by `data-v` hash) rather than guessing.
- **Dynamic Workflow is agent-driven:** the composer must not offer a manual workflow toggle (guarded by `test/settings-ui.test.ts`); the chip renders read-only from server-set session state, and `/workflow` is a daemon-routed command (`test/daemon-contracts.test.ts`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
