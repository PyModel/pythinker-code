# Pythinker Web

A browser client for Pythinker Code — a peer to the TUI (`apps/pythinker-code`) that talks
to a local **server** over REST + WebSocket. Vue 3 + Vite + TypeScript.

---

## Quick start

```bash
# Against a REAL server (the server must be running and reachable)
WEB_PORT=5197 PYTHINKER_SERVER_URL=http://192.168.97.91:58627 pnpm -C apps/pythinker-web run dev
#   …or from the repo root:  pnpm dev:web   (uses the defaults below)

# checks
pnpm -C apps/pythinker-web run typecheck     # vue-tsc --noEmit
pnpm -C apps/pythinker-web run test          # vitest (pure logic only)
pnpm -C apps/pythinker-web run build         # vite build
```

### How it connects to the server

The browser cannot reach the server cross-origin (no CORS), so Vite **same-origin
proxies** `/api/v1` (HTTP + WS) to the server (`vite.config.ts`):

| env var           | default                  | meaning                                  |
| ----------------- | ------------------------ | ---------------------------------------- |
| `WEB_PORT`        | `5175`                   | port the dev server listens on           |
| `PYTHINKER_SERVER_URL` | `http://127.0.0.1:58627`  | where `/api/v1` (and `/api/v1/ws`) is forwarded |

> Behind a corporate HTTP proxy, also set `NO_PROXY=<server-host>` (for example,
> `NO_PROXY=127.0.0.1,localhost`) so the proxy forward reaches the server directly.

---

## Architecture

A strict one-direction data flow; components never touch the network or the
reducer — they consume computed view props and call actions.

```
server (REST + WS)
  └─ src/api/daemon/client.ts      REST adapter  (envelope → AppX types)
  └─ src/api/daemon/ws.ts          WS frames → classify → projector/reducer
       └─ agentEventProjector.ts   RAW agent-core events → AppEvent[]
       └─ eventReducer.ts          AppEvent[] → state
  └─ src/composables/usePythinkerWebClient.ts   the ONLY place that imports api + state;
                                           exposes computed view props + actions
  └─ src/components/*.vue          render props, emit intents (no api access)
```

> The directory name `src/api/daemon/` is historical and kept to minimise
> diff churn; conceptually it is the **server** adapter.

- **Adapter** (`src/api/`): wire types are snake_case; `AppX` types are camelCase.
  `config.ts` builds `/api/v1` URLs.
- **Event projector** (`agentEventProjector.ts`): the server streams **raw
  agent-core events** (no `event.` prefix). `classifyFrame` routes raw vs
  protocol (`event.*`) frames; the projector converts them to `AppEvent`s.
- **i18n** (`src/i18n/`): vue-i18n, en/zh, per-namespace flat camelCase keys.
  Detect order: `localStorage('pythinker-locale')` → `navigator.language` → `en`.
---

## Server contract — non-obvious notes

The server's wire protocol has a few things that will bite you if forgotten:

- **Envelope:** every response is `{ code, msg, data, request_id }` and the HTTP
  status is **always 200** — check `code` (0 = ok), not the status.
- **Prompts require five fields.** `POST /sessions/{id}/prompts` must carry
  `{ content, model, thinking, permission_mode, plan_mode }`. The web fills these
  from settings (model ← session/`default_model`, thinking/permission/plan ← the
  StatusLine controls). Sending only `{ content }` → `40001 model …`.
- **Creating a session needs a *registered* workspace.** `workspace_id` must be a
  `wd_<slug>_<hash>` id that exists in the server's registry. Sessions get one
  auto-assigned by cwd, but it isn't *registered* until you `POST /workspaces
  { root }` (idempotent). The web registers on demand before `createSession`
  (otherwise: `workspace not found: wd_…`).
- **Persisted sessions are directly promptable** — selecting an old session and
  sending a message just works; there is **no `:activate` step**.
- **Workspaces** = real folders. `GET/POST/PATCH/DELETE /workspaces`,
  `GET /fs:browse?path=`, `GET /fs:home` back the rail + folder picker.

## Release & deployment

Pythinker Web is **not published as a standalone package**. It ships as the built-in
web UI of the `pythinker` CLI (`apps/pythinker-code`).

### Current release flow

1. **Develop** — `pnpm dev:web` (or `pnpm -C apps/pythinker-web run dev`).
2. **Build** — `pnpm -C apps/pythinker-web run build` produces `apps/pythinker-web/dist`.
3. **Bundle into CLI** — `pnpm -C apps/pythinker-code run build` runs
   `scripts/copy-web-assets.mjs`, which copies `apps/pythinker-web/dist` into
   `apps/pythinker-code/dist-web`.
4. **Publish** — the root `.github/workflows/release.yml` publishes
   `@pymodel/pythinker-code` to npm; `dist-web` is listed in the package `files`
   array, so the built web assets travel with the CLI package.
5. **Serve** — `pythinker web` serves `dist-web` from the
   installed package.

The web UI does not display its own package version or build commit. It is
bundled into the CLI package and follows the published `@pymodel/pythinker-code`
release.

### Suggested improvements

- **Keep the current coupling for now.** Because Pythinker Code is primarily a local
  CLI/server product, bundling the web UI into the CLI package keeps installs
  self-contained and avoids cross-origin/CORS complexity.
- **Add an independent web-deploy workflow only when needed.** If a public
  standalone web deployment is required later, create
  `.github/workflows/web-deploy.yml` that builds `apps/pythinker-web` and uploads
  `dist/` to the chosen static host (S3/CloudFront, Cloudflare Pages, Vercel,
  etc.). Until then, do not maintain a separate deploy target.
- **Keep versioning owned by the CLI release.** `apps/pythinker-web/package.json`
  remains internal workspace metadata; do not surface it as a separate user
  version unless the web app becomes an independently published product.
- **Ensure the web build is exercised in CI.** The root `build` script already
  builds every workspace, so `pnpm run build` in CI covers `apps/pythinker-web`.
  Keep it that way; do not bypass the web build in release pipelines.
