# Upstream sync

This workflow imports Kimi Code releases into Pythinker Code without changing the Pythinker product identity. `blackbox/refrence` is the read-only Kimi upstream checkout; Pythinker development and releases stay in this repository.

## Brand boundary

- Never merge `blackbox/refrence/main` directly into Pythinker `main`.
- Import a full upstream tree through `rebrand.mjs`, commit that tree on `vendor/upstream`, then merge `vendor/upstream` into a fresh sync branch.
- Keep Pythinker names, package scopes, URLs, logos, managed-service policy, and retained fork features.
- Keep deliberate Kimi/Moonshot provider data: `api.moonshot.*`, `api.kimi.com`, `platform.kimi.*`, `kimi-k*` models, `kimi-for-coding`, `moonshot-*` provider IDs, and `MOONSHOT_API_KEY`.
- Merge the pull request with a merge commit. Squash or rebase removes the vendor ancestry that future three-way merges need.

## Import a release

Run each step from the Pythinker repository root unless the command uses `git -C`.

1. Fetch Kimi and select the release commit.

   ```sh
   git -C blackbox/refrence fetch origin
   git -C blackbox/refrence log --oneline --decorate origin/main
   git -C blackbox/refrence show --stat <release-commit>
   ```

2. Export and rebrand the selected tree. Both output locations must be disposable task-local directories because `rebrand.mjs` replaces its output directory.

   ```sh
   export_root="$(mktemp -d "${TMPDIR:-/tmp}/pythinker-upstream.XXXXXX")"
   rebrand_root="$(mktemp -d "${TMPDIR:-/tmp}/pythinker-rebrand.XXXXXX")"
   export_dir="$export_root/tree"
   rebrand_dir="$rebrand_root/tree"
   mkdir "$export_dir"
   git -C blackbox/refrence archive <release-commit> | tar -x -C "$export_dir"
   node scripts/upstream-sync/rebrand.mjs "$export_dir" "$rebrand_dir"
   ```

3. Replace the `vendor/upstream` snapshot in a dedicated worktree and commit it.

   ```sh
   worktree_root="$(mktemp -d "${TMPDIR:-/tmp}/pythinker-vendor.XXXXXX")"
   vendor_worktree="$worktree_root/worktree"
   git worktree add "$vendor_worktree" vendor/upstream
   test "$(git -C "$vendor_worktree" branch --show-current)" = "vendor/upstream"
   rsync --archive --delete --exclude .git "$rebrand_dir/" "$vendor_worktree/"
   git -C "$vendor_worktree" status --short
   git -C "$vendor_worktree" add -A
   git -C "$vendor_worktree" commit -m "vendor: rebrand Kimi Code <release>"
   ```

4. Create a fresh sync branch from current Pythinker `main`, then merge the vendor snapshot. Keep rerere enabled so recorded conflict resolutions replay.

   ```sh
   git switch main
   git pull --ff-only
   git switch -c sync/upstream-<release>
   git config rerere.enabled true
   git merge --no-ff vendor/upstream
   ```

5. Resolve only genuine new conflicts. Retain Pythinker branding and fork features; do not restore upstream managed-account behavior.

## Post-merge checks

Run these checks in order.

1. Find silently deleted files and compare them with the vendor tree. Restore a path that exists in `vendor/upstream` unless it is an intentional Pythinker deletion.

   ```sh
   git diff --name-only ORIG_HEAD..HEAD --diff-filter=D
   git ls-tree -r --name-only vendor/upstream
   ```

2. Require zero camel-case rename residue.

   ```sh
   rg 'dynamic_workflow[A-Z]' --glob '!scripts/upstream-sync/README.md'
   ```

3. Audit every brand match. Only the provider values listed in [Brand boundary](#brand-boundary) can remain.

   ```sh
   rg -in 'kimi|moonshot'
   ```

4. Require English-only source. Pythinker does not ship Chinese localization.

   ```sh
   if rg --pcre2 '\p{Unified_Ideograph}' apps packages plugins scripts \
     --glob '*.{ts,tsx,vue,js,mjs,cjs,sh,ps1}' \
     --glob '!**/dist*/**'; then
     echo 'Literal Han ideographs found in source.' >&2
     exit 1
   fi
   ```

5. Verify that upstream did not restore the removed managed service.

   ```sh
   node scripts/upstream-sync/check-managed.mjs
   ```

6. Run the full gates separately and record each exit status.

   ```sh
   pnpm run build
   pnpm run typecheck
   pnpm run lint
   pnpm run sherif
   pnpm test
   pnpm -C apps/vscode run typecheck
   pnpm -C apps/vscode test
   nix build .#pythinker-code
   node scripts/check-nix-workspace.mjs
   node scripts/upstream-sync/check-managed.mjs
   ```

If `pnpm-lock.yaml` changed, update the `pnpmDeps` hash in `flake.nix` and rerun the Nix build. Treat a full-suite failure as red until the exact failing file passes in isolation and the load-related difference is documented.

## Pull request

Use a Conventional Commit title, fill the pull request template, run `gen-changesets`, and run the local review CLI when the diff exceeds the hosted reviewer limit. Merge only after required checks pass and every review conversation is resolved. Use a merge commit so `main` retains `vendor/upstream` ancestry.

## Known traps

- 3-way merges silently delete files our history removed but upstream didn't touch — always diff vendor file list vs worktree after a merge.
- Git rename detection pairs upstream `vis` with `dashboard` — gone now, but watch for similar pairings.
- Prose rename rules corrupt identifiers; the camel regex (`swarm(?=[A-Z])`) must stay ahead of the snake fallback in rebrand.mjs. Vendor snapshots built before the fix still carry `dynamic_workflowX` residue — sweep after merging.
- Merged package.json/vite.config lose our test tooling (jsdom, @vue/test-utils, test block) — re-check after every web merge.
- Vendor tree carries managed-service code back in on every sync — the D5 strip must be rerere-recorded deletions, plus the grep gate as a backstop.
