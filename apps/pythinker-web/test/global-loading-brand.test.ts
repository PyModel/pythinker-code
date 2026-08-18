import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(join(import.meta.dirname, '../src/components/GlobalLoading.vue'), 'utf-8');

describe('global loading brand', () => {
  it('shows the bundled Pythinker logo instead of a Kimi wordmark', () => {
    expect(component).toContain('src="/logo.png"');
    expect(component).not.toMatch(/kimi/iu);
    expect(existsSync(join(import.meta.dirname, '../public/logo.png'))).toBe(true);
  });
});
