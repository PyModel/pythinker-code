# Contributing to pythinker-code

Thanks for taking the time to contribute! This project moves quickly, and thoughtful contributions from the community are what keep it sharp. The guide below walks you through how we work so your PR has the best chance of landing smoothly.

## Before You Start

Pythinker Code already has opinions on CLI/TUI behavior, agent workflows, and public APIs. If your change shifts that direction, open an issue first so we can align before you invest time in a PR.

We hold AI-assisted contributions to the same standard as hand-written ones. **You should understand what you submit** — what changed, how it behaves at the edges, and why it fits this codebase. If you cannot explain that, the PR is not ready for review.

We only merge PRs aligned with the roadmap. Drive-by refactors without context are unlikely to land.

**External PRs are accepted for approved bug fixes only.** Open an issue first and wait for a maintainer to approve it with an `/approve` comment, then link that issue in your PR. PRs without an approved linked issue may be closed without review; once the issue is approved, ask a maintainer to reopen your PR.

**Discuss first** — open an issue before coding:

- Bug fixes, including small or typo-level ones: open a bug issue and wait for a maintainer's `/approve` before opening the PR
- New features or user-visible behavior changes (regardless of size): external feature PRs are not accepted — features are discussed and decided in issues, and accepted features are implemented by the team or by explicit maintainer invitation
- Refactors or other changes larger than ~100 lines
- Public API or compatibility changes

## Project Layout

This is a pnpm monorepo. The most relevant entry points are:

- `apps/pythinker-code` — CLI / TUI
- `apps/vscode` — VS Code extension
- `apps/vis` — session debug visualizer
- `packages/node-sdk` — public TypeScript SDK (`@pymodel/pythinker-code-sdk`)
- `packages/agent-core-v2` — the agent engine (v2, DI Scope architecture); `packages/agent-core` is v1 and being phased out
- `packages/klient`, `agent-gateway`, `protocol`, `transcript`, `kosong`, `pyaos`, `oauth`, `telemetry` — internal engine packages
- `docs/` — VitePress bilingual docs site

For the full project map, see [AGENTS.md](AGENTS.md).

## Development Setup

Prerequisites: Node.js >= 24.15.0, pnpm 10.34.3, Git.

```sh
git clone https://github.com/PyModel/pythinker-code.git
cd pythinker-code
pnpm install
```

Useful scripts:

- `pnpm dev:cli` — run the CLI in dev mode
- `pnpm test` — run tests (vitest)
- `pnpm typecheck` — TypeScript check (note: builds packages first)
- `pnpm lint` — oxlint
- `pnpm lint:fix` — oxlint with auto-fix
- `pnpm build` — build all packages

## Commit Convention

All commits and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/).

| Type     | Use for                                     | Example                                   |
|----------|---------------------------------------------|-------------------------------------------|
| feat     | A new feature                               | feat(agent-core): add tool dedup          |
| fix      | A bug fix                                   | fix(tui): correct status bar alignment    |
| docs     | Documentation only                          | docs: clarify install instructions        |
| chore    | Tooling / housekeeping                      | chore: bump dependencies                  |
| refactor | Internal refactor without behavior change   | refactor(kosong): extract retry helper    |
| test     | Adding or improving tests                   | test(agent-core): cover skill resolver    |
| ci       | CI / build pipeline changes                 | ci: cache pnpm store                      |
| build    | Build system / artifact changes             | build(native): add win32-arm64 target     |
| perf     | Performance improvement                     | perf(session): batch event flushes        |
| style    | Formatting only (no logic)                  | style: apply oxlint --fix                 |

PR titles are enforced by the `pr-title-checker` workflow — a non-conforming title will block merge.

## Changesets

This repo uses [changesets](https://github.com/changesets/changesets) to manage versioning and releases.

- Every PR that affects release artifacts (code, behavior, public API) **must** include a changeset.
- Docs-only, test-only, or CI-only PRs may skip changesets.
- Generate one with `pnpm changeset` and follow the prompts (which packages are touched, which bump level).
- For repo-specific conventions on package selection and bump levels, see `.changeset/README.md`. When working in this repo with coding agents, use the `gen-changesets` skill.

### Bump levels

Pythinker Code follows semantic versioning. The commit type you would have written decides the level:

| Commit type | Level | Use for | Example |
| --- | --- | --- | --- |
| `fix`, `perf`, `security` | `patch` | A fix, a speed-up, or a small addition to something that already exists | `1.2.0` → `1.2.1` |
| `feat` | `minor` | A capability a user could not reach before | `1.2.8` → `1.3.0` |
| a break | `major` | Something that worked stops working, or works differently | `1.x` → `2.0.0` |

Each number counts on its own and none of them roll over at nine. Ten fixes on top of `1.2.0` land on `1.2.10`, not `1.3.0`; the minor moves only when a feature ships, and the major only when something breaks:

```text
1.2.9  + fix      → 1.2.10
1.9.9  + fix      → 1.9.10
1.9.9  + feature  → 1.10.0
1.x    + break    → 2.0.0
```

Prefer one changeset per pull request. A pull request that needs several is usually carrying several separate releases, and once they are versioned together the changelog can no longer say which change each entry came from.

A `major` needs a maintainer's sign-off: the `changeset-policy` workflow fails a pull request that adds a major changeset, or edits an existing one up to `major`, unless it carries the `breaking-change-approved` label. A pinned install keeps working, but every consumer who upgrades has to deal with the break, and an npm publish cannot be taken back — so it is a decision, never a side effect of a large branch. Nothing else can reach a major: no amount of counting gets there on its own.

### A released version is one exact build, forever

Once a version exists, everything published under it is frozen. This matters most for the desktop app and the native CLI bundles, where a version number is what an updater resolves to a specific set of bytes it has already advertised.

Never do any of these:

- Overwrite the assets on a published release
- Move a tag that has shipped
- Rebuild binaries and publish them under a version that already exists
- Replace `latest.yml` / `latest-mac.yml` / `manifest.json` for a version whose binaries are already out

To correct a bad build, cut the next patch instead: fix the problem, bump, build from that exact commit, sign and notarize, and publish fresh artifacts under the new number. The updater then advertises the new version, and anyone who already installed the old one keeps a build that still matches what it claims to be.

CI enforces this rather than trusting the rule. The desktop release uploads into a draft and refuses to touch a release that is already published. The native CLI job treats its assets as one set — `manifest.json` pins a sha256 for every zip — so it uploads all of them or none: a release that already has the full set is left alone, and a partial set stops the job rather than pairing zips from one build with checksums from another.

### Release cadence

Changesets keeps a `ci: release packages` pull request open on `main` and rewrites it as changesets land. Merging it cuts exactly one release, so how often it is merged is what decides the version sequence:

- Merged per change, versions follow each change: `1.2.1`, `1.2.2`, `1.2.3`, `1.3.0`.
- Left to accumulate, a backlog collapses into one bump and the numbers in between never exist.

The repository variable `AUTO_MERGE_RELEASE_PR` chooses between the two. Set to `true`, the release pull request merges itself once its required checks pass, giving one release per change. Unset or `false`, a maintainer merges it when a release is wanted.

Either way there is a window: a changeset that lands while the release pull request is waiting on its checks joins that release instead of starting the next one. That is how changesets works, so a release can still carry more than one change — one changeset per pull request keeps the window small.

## Pull Requests

Every PR opens with the [PR template](.github/pull_request_template.md). PR titles must follow [Conventional Commits](#commit-convention); CI runs `pnpm lint`, `pnpm typecheck`, and `pnpm test` on every PR. Update user-facing docs in `docs/` when behavior changes — use the `gen-docs` skill when working with coding agents.

## Code Style

- TypeScript across the codebase.
- Linting via `oxlint` (config in `.oxlintrc.json`).
- Auto-formatting via `pnpm lint:fix`.
- Follow existing local patterns when the lint rules do not cover a style choice.

## Reporting Security Issues

Found a security issue? Please see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing to this repository, you agree that your contributions will be licensed under the [MIT License](LICENSE).
