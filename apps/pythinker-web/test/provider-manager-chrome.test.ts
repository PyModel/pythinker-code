import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// The header, the footer, and the provider list all paint their own background
// to the dialog edge, so a rounded dialog needs to clip them. jsdom applies no
// scoped-SFC styles, so the rule itself is the contract under test.
const source = readFileSync(
  resolve(import.meta.dirname, '../src/components/ProviderManager.vue'),
  'utf8',
);

function blockOf(selector: string): string {
  const start = source.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end);
}

describe('ProviderManager dialog chrome', () => {
  it('clips its children to the rounded corners', () => {
    const dialog = blockOf('.dialog');

    expect(dialog).toMatch(/border-radius:\s*4px/);
    expect(dialog).toMatch(/overflow:\s*hidden/);
  });

  it('leaves the corner rounding to the dialog instead of the footer', () => {
    expect(blockOf('.footer-hint')).not.toMatch(/border-radius/);
  });
});
