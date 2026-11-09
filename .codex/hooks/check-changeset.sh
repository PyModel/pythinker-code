#!/usr/bin/env bash
# Pre-hook: block `gh pr create` when shipped-code paths (packages/*, apps/*)
# are changed but no changeset was added under .changeset/.
# Enforces locally what AGENTS.md already mandates: run the gen-changesets
# skill before every PR. Adapted from pythinker-cli's check-changelog.sh.

set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Only intercept gh pr create invocations.
if ! printf '%s' "$cmd" | grep -q 'gh pr create'; then
  exit 0
fi

# Skip release-prep branches/titles (the changesets "version" PR consumes
# .changeset/*.md files, so it legitimately has none to add).
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$branch" in
  changeset-release/*) exit 0 ;;
esac
if printf '%s' "$cmd" | grep -qF 'ci: release packages'; then
  exit 0
fi
# [skip changeset] anywhere in the command body is an escape hatch.
if printf '%s' "$cmd" | grep -qiF '[skip changeset]'; then
  exit 0
fi

# Determine which files changed vs the merge-base with origin/main.
base=$(git merge-base HEAD origin/main 2>/dev/null || echo "")
if [ -z "$base" ]; then
  # Can't determine base — don't block.
  exit 0
fi
changed=$(git diff --name-only "$base" HEAD 2>/dev/null || echo "")

# Shipped-code paths: workspace packages and apps.
touched=0
has_changeset=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    .changeset/*.md) has_changeset=1 ;;
    packages/*|apps/*) touched=1 ;;
  esac
done <<< "$changed"

[ "$touched" -eq 0 ] && exit 0
[ "$has_changeset" -eq 1 ] && exit 0

# Block and tell the author exactly what to do.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Changeset gate: this branch touches packages/ or apps/ but adds no .changeset/*.md.\n\nRun the gen-changesets skill (.agents/skills/gen-changesets/SKILL.md) and generate a changeset before opening the PR.\n\nEscape hatches:\n  - Add [skip changeset] in the PR body (docs/CI-only changes)\n  - Branch changeset-release/* or title ci: release packages"}}'
