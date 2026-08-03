/**
 * Read the server's own `package.json` version at boot. Mirrors
 * `packages/agent-core/src/version.ts:4-13` so the server's `/meta` can
 * report a real version without taking an SDK / agent-core export dep.
 *
 * Tries the bundled-at-build `package.json` next to `dist/` first; falls back
 * to `0.0.0` if the file is unreachable (e.g. tree-shaken bundle).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

export function getServerVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const raw = readFileSync(fileURLToPath(pkgUrl), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
