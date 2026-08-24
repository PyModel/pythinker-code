import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-product-boundaries.mjs';
const failures = [];

const removedPaths = [
  'apps/pythinker-web/src/components/dialogs/LoginDialog.vue',
  'packages/agent-gateway/src/routes/oauth.ts',
  'packages/oauth/src/managed-feedback-upload.ts',
  'packages/oauth/src/managed-feedback.ts',
  'packages/oauth/src/managed-pythinker-code.ts',
  'packages/oauth/src/managed-tools.ts',
  'packages/oauth/src/managed-usage.ts',
  'packages/oauth/src/managed-userinfo.ts',
];

for (const file of removedPaths) {
  if (existsSync(path.join(ROOT, file))) failures.push(`${file}: removed surface exists`);
}

const allowedLegacyEnvAssertions = new Set([
  'packages/agent-core/test/rpc/plugins-rpc.test.ts',
]);

const forbidden = [
  { label: 'hosted provider slot', pattern: /['"`]managed:[a-z0-9-]+['"`]/i },
  { label: 'hosted provider constant', pattern: /PYTHINKER_CODE_PROVIDER_NAME/ },
  { label: 'hosted OAuth flow config', pattern: /PYTHINKER_CODE_FLOW_CONFIG/ },
  { label: 'hosted OAuth default', pattern: /DEFAULT_PYTHINKER_CODE_OAUTH_HOST/ },
  { label: 'hosted inference endpoint', pattern: /api\.kimi\.com\/coding/i },
  { label: 'hosted model alias', pattern: /pythinker-code\/kimi-for-coding/i },
  { label: 'removed provider OAuth route', pattern: /\/api\/v1\/oauth\/(?:login|logout|usage|userinfo)\b/i },
  { label: 'removed provider refresh action', pattern: /refresh_oauth/i },
  {
    label: 'removed hosted-service environment variable',
    pattern: /PYTHINKER_(?:CODE_(?:BASE_URL|OAUTH_HOST)|OAUTH_HOST)/,
    allow: allowedLegacyEnvAssertions,
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

for (const file of tracked) {
  if (excluded(file)) continue;
  const absolute = path.join(ROOT, file);
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    continue;
  }
  if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) continue;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (const rule of forbidden) {
    if (rule.allow?.has(file)) continue;
    for (const [index, line] of lines.entries()) {
      if (rule.pattern.test(line)) failures.push(`${file}:${index + 1}: ${rule.label}`);
    }
  }
}

const identity = readFileSync(path.join(ROOT, 'packages/oauth/src/identity.ts'), 'utf8');
if (identity.includes('X-Msh-')) {
  failures.push('packages/oauth/src/identity.ts: default identity must contain only User-Agent');
}

const platformSelector = readFileSync(
  path.join(ROOT, 'apps/pythinker-code/src/tui/components/dialogs/platform-selector.ts'),
  'utf8',
);
if (platformSelector.includes("'pythinker-code'")) {
  failures.push('apps/pythinker-code/src/tui/components/dialogs/platform-selector.ts: hosted login entry exists');
}

if (failures.length > 0) {
  process.stderr.write(`Product boundary check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Product boundary check passed.\n');
}

function excluded(file) {
  return (
    file === SELF ||
    file === 'pnpm-lock.yaml' ||
    file.startsWith('.changeset/') ||
    file.startsWith('blackbox/') ||
    file.includes('/dist-web/') ||
    file.includes('/dist/') ||
    file.toLowerCase().endsWith('changelog.md')
  );
}
