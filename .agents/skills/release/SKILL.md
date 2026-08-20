---
name: release
description: Use when cutting, debugging, or verifying a pythinker-code (TSC monorepo) release — changesets flow, the ci release-packages version PR, release.yml anatomy, npm Trusted Publishing OIDC, native assets, brew tap, CDN redeploy, and their failure modes. Invoked by /release.
---

# pythinker-code (TSC) Release

Tracked repository skill. Companion to `/release`, which holds the step-by-step procedure; this file holds the
mechanics and failure modes.

## Release model

- **Changesets, not tags.** Contributors land PRs with `.changeset/*.md` entries (authored via the
  tracked `gen-changesets` skill, `.agents/skills/gen-changesets/SKILL.md`). Versions and CHANGELOGs
  are machine-generated from those entries. Nobody edits a version number by hand.
- **Two-phase CI flow** on every push to `main` (`.github/workflows/release.yml`):
  1. *Pending changesets exist* → changesets action runs `pnpm run version:release`
     (= `changeset version`) and opens/updates the **`ci: release packages`** PR.
  2. *That PR merges* → next run finds no pending changesets but bumped versions → publishes via
     `node scripts/release/changeset-publish-idempotent.mjs`, creates the GitHub Release at tag
     `@pythoughts/pythinker-code@<version>`, and fans out to downstream jobs.
- **Publishing is CI-only** via npm Trusted Publishing (OIDC, `id-token: write`). The workflow
  deliberately sets **no `NPM_TOKEN`** — changesets prefers a token over OIDC when one is set, so
  adding it would silently downgrade publishing to a long-lived secret. Never "fix" a publish
  failure by adding NPM_TOKEN, and never run `changeset publish` locally.
- The root `publish` script in `package.json` chains the full local gate
  (`typecheck → lint → sherif → test → build → lint:pkg → changeset publish`) — it exists for gate
  parity, not for actually publishing from a laptop.

## What publishes

`.changeset/config.json` `ignore` list excludes almost every internal package
(`agent-core`, `kaos`, `kosong`, `server`, dashboards, web, …). Effective publishable set =
non-private, non-ignored workspace packages — in practice **`@pythoughts/pythinker-code`** and the
SDK-adjacent packages not on the ignore list. When adding a workspace package, decide its ignore/
publish status explicitly, and remember `flake.nix` workspace lists must be updated by hand
(root `AGENTS.md`).

## release.yml job map

| Job | Trigger | Notes |
|---|---|---|
| `Release` | every main push | install → build catalog → `pnpm build` → changesets action |
| `Redeploy code.pythinker.com` | `packages_published == 'true'` | runs `scripts/release/verify-release-consistency.mjs`, then POSTs `DOKPLOY_CDN_DEPLOY_WEBHOOK` (skips with a warning if the secret is unset) |
| `Update Homebrew tap` | published | `scripts/release/update-brew-formula.mjs` with `TAP_GITHUB_TOKEN` (skips if unset) |
| `Deploy docs` | published | reusable `docs-deploy.yml` |
| `Native release artifact` | `pythinker_native_release == 'true'` | reusable `_native-build.yml`, macOS signing/notarization secrets |
| `Publish native release assets` | native release | `produce-manifest.mjs` then `gh release upload <tag> … --clobber` |

`pythinker_native_release` and the release tag come from
`apps/pythinker-code/scripts/native/resolve-release.mjs`, driven by the changesets action's
`publishedPackages` output; the tag format is `@pythoughts/pythinker-code@<version>`.

## Failure modes and known lessons

- **"cannot publish over previously published versions" / failed publish on a no-op push.** This is
  the exact bug `changeset-publish-idempotent.mjs` fixes: under Trusted Publishing the action
  exports a placeholder `NODE_AUTH_TOKEN`, the registry rejects changesets' published-version read,
  and it republishes. The wrapper pre-checks the registry with a **clean env** (auth vars stripped)
  and exits 0 when every publishable version is already live. If this error still appears, suspect a
  genuinely half-published release — read the log; do not blind-rerun.
- **Version PR looks wrong.** Never patch the `changeset-release/main` branch by hand. Fix or add
  changesets on `main`; the next workflow run regenerates the PR.
- **Native builder fails after npm publish succeeded.** npm state is final; native jobs are
  re-runnable against the same workflow run (`gh run rerun <id> --failed`). `--clobber` on asset
  upload makes re-runs safe.
- **CDN not updated after publish.** `verify-release-consistency.mjs` gates the webhook: local
  `apps/pythinker-code/package.json` version must equal the npm `latest` dist-tag (plus sane
  `beta`/`dev` tags). A mismatch means the checkout in the job predates the release commit or npm
  propagation lag — check `npm view @pythoughts/pythinker-code dist-tags` before touching anything.
  Dokploy deploy specifics: see memory `cdn-dokploy-deploy-pipeline`.
- **`pnpm install` fails in CI or locally.** `engine-strict=true` + Node `>=24.15.0` — check
  `.nvmrc` before debugging anything else.
- **Pre-push hook** (`scripts/pre-push.sh` via simple-git-hooks) gates local pushes; a hook failure
  is a real gate failure — fix the cause, never `--no-verify`.

## Verification commands

```bash
gh run list --workflow=release.yml --branch=main -L 3        # workflow health
gh pr list --search 'ci: release packages in:title' --state open
npm view @pythoughts/pythinker-code version                   # published version
npm view @pythoughts/pythinker-code dist-tags --json
node scripts/release/verify-release-consistency.mjs           # local == npm latest
gh release view "@pythoughts/pythinker-code@<version>"        # assets + manifest.json
```

## Hard rules (mirror tracked contracts)

- No `major` bump without explicit user approval (root `AGENTS.md`).
- No co-author trailers, no agent identity in commits/PRs; git author `elkaix <melkholy@techmatrix.com>`.
- PR titles follow Conventional Commits; fill `.github/pull_request_template.md` substantively.
- Merging the version PR is the irreversible step — confirm with the user before merging.
