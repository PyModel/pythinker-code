#!/usr/bin/env node
/**
 * D5 gate: the managed-service strip must survive every upstream sync.
 * Each check pins one choke point removed from the vendor tree; a future
 * 3-way merge that reintroduces managed sign-in or managed fallbacks fails
 * here instead of shipping silently. Run from the repo root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const failures = [];

function check(label, ok) {
  if (!ok) failures.push(label);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

const platformSelector = read('apps/pythinker-code/src/tui/components/dialogs/platform-selector.ts');
check(
  'TUI login menu must not offer the managed pythinker-code OAuth entry',
  !platformSelector.includes("'pythinker-code'"),
);

const oauthRoutes = read('packages/agent-gateway/src/routes/oauth.ts');
check(
  'agent-gateway must not expose /oauth/usage',
  !oauthRoutes.includes('/oauth/usage'),
);
check(
  'agent-gateway must not expose /oauth/userinfo',
  !oauthRoutes.includes('/oauth/userinfo'),
);
check(
  'agent-gateway /oauth/login must reject the managed provider (PROVIDER_OAUTH_MANAGED guard)',
  oauthRoutes.includes('PROVIDER_OAUTH_MANAGED'),
);

check(
  'web app must not ship the managed LoginDialog',
  !existsSync('apps/pythinker-web/src/components/dialogs/LoginDialog.vue'),
);

const identity = read('packages/oauth/src/identity.ts');
const defaultHeadersBody = identity.slice(identity.indexOf('function createPythinkerDefaultHeaders'));
check(
  'createPythinkerDefaultHeaders must not attach X-Msh device headers',
  !defaultHeadersBody.slice(0, defaultHeadersBody.indexOf('}')).includes('X-Msh'),
);

for (const file of [
  'packages/agent-core-v2/src/app/web/webService.ts',
  'packages/agent-core-v2/src/app/auth/webSearch/webSearchService.ts',
]) {
  check(
    `${file} must not fall back to the managed OAuth provider`,
    !read(file).includes('fromManagedOAuth'),
  );
}

const trackedFiles = execSync('git ls-files -z').toString().split('\0').filter(Boolean);
const kimiHostPattern = /\b(?:[a-z0-9-]+\.)*kimi\.com\b/gi;

for (const file of trackedFiles) {
  if (file.startsWith('scripts/upstream-sync/') || file.startsWith('blackbox/')) continue;

  let contents;
  try {
    contents = readFileSync(file);
  } catch {
    continue;
  }
  if (contents.length > 2 * 1024 * 1024 || contents.includes(0)) continue;

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch {
    continue;
  }

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(kimiHostPattern)) {
      const host = match[0].toLowerCase();
      if (host === 'api.kimi.com' || host === 'auth.kimi.com' || host.startsWith('platform.kimi.')) {
        continue;
      }
      failures.push(`${file}:${index + 1} — ${match[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error('check-managed: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-managed: OK');
