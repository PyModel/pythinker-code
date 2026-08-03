#!/usr/bin/env bash
# Rejects pushes when any outgoing commit contains AI agent attribution.
set -euo pipefail

readonly ZERO_OID='0000000000000000000000000000000000000000'

# Case-insensitive patterns for AI/tool attribution in commit messages.
readonly FORBIDDEN_PATTERN='(^co-authored-by:.*(cursor|composer|claude|anthropic|openai|codex|copilot|github[[:space:]]*copilot|gemini|chatgpt|gpt-[0-9]|windsurf|devin|cascade|cody|tabnine|continue[[:space:]]*dev|aider|codeium|replit|phind|bolt[[:space:]]*new|v0[[:space:]]*dev|pythinker|cursoragent|ai[[:space:]]+assistant|ai[[:space:]]+agent)|^made-with:.*cursor|^made-by:.*(cursor|claude|copilot|openai|gemini|anthropic)|^generated-by:.*(cursor|claude|copilot|ai)|cursoragent@cursor\.com|done by ai|written with cursor)'

check_commit() {
  local sha="$1"
  local msg matches

  msg=$(git log -1 --format=%B "$sha" 2>/dev/null || true)
  if [[ -z "$msg" ]]; then
    return 0
  fi

  matches=$(printf '%s\n' "$msg" | grep -Ei "$FORBIDDEN_PATTERN" || true)
  if [[ -n "$matches" ]]; then
    echo "ERROR: Push blocked — commit ${sha:0:12} contains forbidden AI agent attribution." >&2
    printf '%s\n' "$matches" | sed 's/^/  /' >&2
    echo >&2
    echo "Remove attribution with: git rebase -i <base>  (edit/amend offending commits)" >&2
    echo "Policy: .cursor/rules/no-ai-agent-attribution.mdc" >&2
    return 1
  fi

  return 0
}

commits_for_push() {
  local local_oid="$1"
  local remote_oid="$2"

  if [[ "$remote_oid" == "$ZERO_OID" ]]; then
    if git show-ref --verify --quiet refs/remotes/origin/HEAD; then
      local upstream
      upstream=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)
      if [[ -n "$upstream" ]]; then
        git rev-list "$local_oid" --not "$upstream" 2>/dev/null && return 0
      fi
    fi

    git rev-list "$local_oid" 2>/dev/null
    return 0
  fi

  git rev-list "${remote_oid}..${local_oid}" 2>/dev/null
}

failed=0

while read -r _local_ref local_oid _remote_ref remote_oid; do
  if [[ "$local_oid" == "$ZERO_OID" ]]; then
    continue
  fi

  while IFS= read -r sha; do
    [[ -z "$sha" ]] && continue
    check_commit "$sha" || failed=1
  done < <(commits_for_push "$local_oid" "$remote_oid")
done

if [[ "$failed" -ne 0 ]]; then
  echo "Push rejected: remove all AI agent attribution from outgoing commits." >&2
  exit 1
fi

exit 0
