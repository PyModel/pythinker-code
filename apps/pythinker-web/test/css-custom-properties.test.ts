import { existsSync, globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * An unresolvable `var(--x)` makes the whole declaration invalid at computed-value
 * time, so the property silently falls back to its initial value — a background
 * becomes transparent, a colour becomes black. That reads as a rendering bug, not
 * a typo, so pin it here: every custom property must be defined somewhere in the
 * app, or carry a fallback at the point of use.
 */

const SRC = ['src', 'apps/pythinker-web/src'].find(existsSync);
if (SRC === undefined) throw new Error('the web app source directory was not found');

const sources = globSync('**/*.{vue,css,ts}', { cwd: SRC }).map((file) =>
  readFileSync(`${SRC}/${file}`, 'utf8'),
);
const all = sources.join('\n');

/** Names used without a fallback: `var(--x)` but not `var(--x, …)`. */
const usedWithoutFallback = new Set(
  [...all.matchAll(/var\((--[a-z\d-]+)\s*\)/gu)].map((match) => match[1]!),
);
const defined = new Set([...all.matchAll(/(--[a-z\d-]+)\s*'?\s*:/gu)].map((match) => match[1]!));

describe('CSS custom properties', () => {
  it('finds custom properties to check', () => {
    expect(usedWithoutFallback.size).toBeGreaterThan(50);
  });

  it('resolves every custom property used without a fallback', () => {
    const missing = [...usedWithoutFallback].filter((name) => !defined.has(name)).toSorted();

    expect(missing).toEqual([]);
  });
});
