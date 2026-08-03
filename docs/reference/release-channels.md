# Release Channels

Pythinker Code CLI is published through three npm release channels. Choose a channel by installing its npm dist-tag.

| Channel | What it provides | npm dist-tag | Install command | Stability promise |
| --- | --- | --- | --- | --- |
| latest | Stable releases | `latest` | `npm i -g @pythoughts/pythinker-code@latest` | Recommended for normal use |
| beta | Prereleases for an upcoming stable version | `beta` | `npm i -g @pythoughts/pythinker-code@beta` | May include incomplete or breaking changes |
| dev | Nightly snapshots from the current `main` branch | `dev` | `npm i -g @pythoughts/pythinker-code@dev` | No stability guarantee; a new version is published only when commits change |

## Running a Beta Cycle

Maintainers start a beta cycle with:

```sh
pnpm changeset pre enter beta
```

Merge the generated release pull request to publish beta prereleases. When the beta is ready to become stable, leave prerelease mode and merge the resulting release pull request:

```sh
pnpm changeset pre exit
```

## Stable Update Rollout

The CLI checks a stable update manifest and assigns each device to a deterministic rollout bucket. A new stable version may therefore appear on one device before another. Eligible devices receive the update within 24 hours.

The update CDN at `code.pythinker.com` tracks only the stable `latest` channel. Beta and dev users install updates directly from their npm dist-tags.
