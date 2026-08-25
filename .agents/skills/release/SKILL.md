---
name: release
description: Use when cutting, debugging, or verifying a pythinker-code (TSC monorepo) release — changesets flow, the ci release-packages version PR, release.yml anatomy, npm Trusted Publishing OIDC, native assets, brew tap, CDN redeploy, and their failure modes. Invoked by /release.
---

# pythinker-code (TSC) Release

Tracked repository skill. Companion to `/release`, which holds the step-by-step procedure; this file holds the
mechanics and failure modes.

## Release model

- **Changesets, not manual version edits.** Contributor PRs add `.changeset/*.md`. The changesets
  action creates or updates the `ci: release packages` PR. Merging that PR publishes the public npm
  package and creates `@pymodel/pythinker-code@<version>`.
- **npm publishing is CI-only.** Trusted Publishing uses OIDC. Do not add `NPM_TOKEN`; a token takes
  precedence over OIDC. Do not run `changeset publish` locally.
- **Private lanes use the push boundary.** `publishedPackages` only lists packages published to npm.
  Desktop and VS Code are private workspaces, so `detect-lane-bumps.mjs` compares their versions at
  `github.event.before` and `github.sha`.
- **Desktop is tag-driven.** The required `cut-desktop-tag` job creates `desktop-v<version>`, which
  starts `desktop-release.yml`.
- **VS Code is isolated.** `vscode-release.yml` supports `workflow_call` and version-checked manual
  dispatch. Existing registry versions are skipped by the publisher scripts, so recovery is safe.

## What publishes

`@pymodel/pythinker-code` is the public npm package. Desktop and VS Code package files are private;
their versions are release signals but changesets does not publish them to npm. When adding a
workspace, set its `private` and changesets policy explicitly and update `flake.nix`.

## release.yml job map

| Job | Trigger | Notes |
|---|---|---|
| `Release` | every main push after CI + Nix | Detect lane versions, build, run changesets |
| `Cut desktop release tag` | desktop version changed | Required and idempotent; App token makes the tag trigger the desktop workflow |
| `Publish VS Code extension` | extension version changed | Reusable workflow; six VSIX targets, both registries, provenance |
| `Native release artifact` | CLI was published | Six signed/tested zips, checksums, provenance |
| `Publish native release assets` | native builds passed | All-or-nothing immutable upload with `manifest.json` |
| `Redeploy CDN` + verify | native assets published | Webhook may retry; verification is the hard gate |
| `Update Homebrew tap` | CLI was published | App token scoped to `homebrew-tap` contents |
| `Release lane summary` | always | One table with provenance state; fails when an expected enabled lane failed or skipped |

Set `RELEASE_LANE_DESKTOP`, `RELEASE_LANE_VSCODE`, `RELEASE_LANE_CDN`, or
`RELEASE_LANE_BREW` to exactly `disabled` for a conscious temporary opt-out. Missing credentials are
otherwise errors.

## Failure modes and known lessons

- **"cannot publish over previously published versions" / failed publish on a no-op push.** This is
  the exact bug `changeset-publish-idempotent.mjs` fixes: under Trusted Publishing the action
  exports a placeholder `NODE_AUTH_TOKEN`, the registry rejects changesets' published-version read,
  and it republishes. The wrapper pre-checks the registry with a **clean env** (auth vars stripped)
  and exits 0 when every publishable version is already live. If this error still appears, suspect a
  genuinely half-published release — read the log; do not blind-rerun.
- **Version PR looks wrong.** Never patch the `changeset-release/main` branch by hand. Fix or add
  changesets on `main`; the next workflow run regenerates the PR.
- **Native builder fails after npm publish succeeded.** npm state is final. Re-run failed jobs from
  the same run before any assets upload. A complete asset set is an idempotent no-op. A partial set
  must not be filled from a rebuild; keep it or publish a new patch version.
- **CDN not updated after publish.** `verify-release-consistency.mjs` gates the webhook: local
  `apps/pythinker-code/package.json` version must equal the npm `latest` dist-tag (plus sane
  `beta`/`dev` tags). A mismatch means the checkout in the job predates the release commit or npm
  propagation lag — check `npm view @pymodel/pythinker-code dist-tags` before touching anything.
  Dokploy deploy specifics: see memory `cdn-dokploy-deploy-pipeline`.
- **`pnpm install` fails in CI or locally.** `engine-strict=true` + Node `>=24.15.0` — check
  `.nvmrc` before debugging anything else.
- **Pre-push hook** (`scripts/pre-push.sh` via simple-git-hooks) gates local pushes; a hook failure
  is a real gate failure — fix the cause, never `--no-verify`.

## Recovery

| Symptom | Command | Safety |
|---|---|---|
| Desktop tag job failed | `git tag desktop-v<VERSION> <RELEASE_SHA> && git push origin desktop-v<VERSION>` | Confirm the tag does not exist first; pushing it starts a public release workflow |
| VS Code lane partially failed | `gh workflow run vscode-release.yml --ref <RELEASE_SHA> -f expected-version=<VERSION>` | Version is checked; both publishers skip versions already present |
| Native matrix failed before upload | `gh run rerun <RUN_ID> --failed` | Reuses the same run and commit; do not mix a rebuilt partial asset set |
| CDN is stale | Re-run the failed `Redeploy CDN` or verification job | Do not republish npm; nightly reconciliation remains red until aligned |
| Unknown lane drift | `pnpm release:status` | Read-only; queries npm, GitHub Releases, CDN, Marketplace, and Open VSX |

## Verification commands

```bash
gh run list --workflow=release.yml --branch=main -L 3        # workflow health
gh pr list --search 'ci: release packages in:title' --state open
pnpm release:status                                           # all live lanes
npm view @pymodel/pythinker-code dist-tags --json
node scripts/release/verify-release-consistency.mjs
gh release view "@pymodel/pythinker-code@<version>"
gh attestation verify <artifact> -R PyModel/pythinker-code
```

## Hard rules (mirror tracked contracts)

- No `major` bump without explicit user approval (root `AGENTS.md`).
- No co-author trailers, no agent identity in commits/PRs; git author `elkaix <melkholy@techmatrix.com>`.
- PR titles follow Conventional Commits; fill `.github/pull_request_template.md` substantively.
- Merging the version PR is the irreversible step — confirm with the user before merging.
