#!/usr/bin/env bash
# Blocks git commit/amend commands that inject AI agent attribution.
set -euo pipefail

input=$(cat)

command=$(
  printf '%s' "$input" | node -e "
    let s = '';
    process.stdin.on('data', (chunk) => { s += chunk; });
    process.stdin.on('end', () => {
      try {
        const parsed = JSON.parse(s);
        process.stdout.write(String(parsed.command ?? ''));
      } catch {
        process.stdout.write('');
      }
    });
  "
)

if [[ -z "$command" ]]; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

if printf '%s' "$command" | grep -Eiq '(^|[;&|[:space:]])(git[[:space:]]+.*(commit|amend|merge)|^git[[:space:]]+.*(commit|amend|merge))'; then
  if printf '%s' "$command" | grep -Eiq \
    '(--trailer|co-authored-by:|made-with:|made-by:|generated-by:|cursoragent@cursor\.com|done by ai|written with cursor)'; then
    cat <<'EOF'
{
  "permission": "deny",
  "user_message": "Blocked: AI agent attribution in commits is forbidden by project policy.",
  "agent_message": "Do not add Co-authored-by, Made-with, --trailer, or any AI attribution to git commits. Use plain `git commit -m \"message\"` only. If attribution was added by the environment, amend the commit to remove it without bypassing hooks."
}
EOF
    exit 2
  fi
fi

printf '%s\n' '{"permission":"allow"}'
exit 0
