/**
 * The desktop app is a shell around the CLI and the web UI, so every CLI
 * release changes what desktop users see. Changesets only bumps a package a
 * changeset names, and most changesets name the CLI alone, so the CLI shipped
 * to npm while desktop stayed on its old version.
 *
 * This runs before `changeset version` on the release branch: every changeset
 * that names the CLI but not the desktop app gets the desktop app added at the
 * same bump level. The desktop changelog then carries the real entries, and
 * `release.yml` cuts the `desktop-v*` tag from the bump it detects. Desktop
 * keeps its own version line; this is deliberately not a `fixed` group.
 *
 * Idempotent: a changeset that already names the desktop app is left alone.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLI_PACKAGE = '@pymodel/pythinker-code';
export const DESKTOP_PACKAGE = '@pymodel/pythinker-desktop';

const FRONTMATTER_LINE = /^(\s*)(?:"([^"]+)"|'([^']+)'|([^:'"]+?))\s*:\s*([A-Za-z]+)\s*$/u;

/**
 * Add the desktop package to one changeset when it names the CLI alone.
 *
 * @param source - Raw changeset file contents.
 * @returns The rewritten source, or `null` when nothing changes.
 */
export function linkDesktop(source) {
  const normalized = source.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  const lines = normalized.slice(4, end + 1).split('\n');

  let cliLine = -1;
  let cliLevel = null;
  for (const [index, line] of lines.entries()) {
    const match = FRONTMATTER_LINE.exec(line);
    if (match === null) continue;
    const name = match[2] ?? match[3] ?? match[4];
    if (name === DESKTOP_PACKAGE) return null;
    if (name === CLI_PACKAGE) {
      cliLine = index;
      cliLevel = match[5].toLowerCase();
    }
  }
  if (cliLine === -1) return null;

  lines.splice(cliLine + 1, 0, `"${DESKTOP_PACKAGE}": ${cliLevel}`);
  return `---\n${lines.join('\n')}${normalized.slice(end + 1)}`;
}

/**
 * Rewrite every changeset in a directory.
 *
 * @param dir - The `.changeset` directory.
 * @returns The file names that changed.
 */
export function linkDesktopChangesets(dir) {
  const changed = [];
  for (const name of readdirSync(dir).toSorted()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const path = join(dir, name);
    const next = linkDesktop(readFileSync(path, 'utf8'));
    if (next === null) continue;
    writeFileSync(path, next);
    changed.push(name);
  }
  return changed;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const changed = linkDesktopChangesets(process.argv[2] ?? '.changeset');
  for (const name of changed) console.log(`linked desktop bump: ${name}`);
  console.log(`${changed.length} changeset(s) now bump ${DESKTOP_PACKAGE} alongside ${CLI_PACKAGE}.`);
}
