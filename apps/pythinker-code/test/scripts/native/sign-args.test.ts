import { describe, expect, it } from 'vitest';

import { buildCodesignArgs } from '../../../scripts/native/04-sign.mjs';

describe('buildCodesignArgs', () => {
  it('returns ad-hoc args for identity "-"', () => {
    const args = buildCodesignArgs({
      identity: '-',
      executable: '/path/pythinker',
      entitlementsPath: '/path/entitlements.plist',
      keychainPath: null,
    });
    expect(args).toEqual(['--sign', '-', '/path/pythinker']);
  });

  it('returns hardened-runtime args for Developer ID identity', () => {
    const args = buildCodesignArgs({
      identity: 'Developer ID Application: Pythoughts (ABCD1234)',
      executable: '/path/pythinker',
      entitlementsPath: '/path/entitlements.plist',
      keychainPath: '/tmp/sign.keychain-db',
    });
    expect(args).toEqual([
      '--sign',
      'Developer ID Application: Pythoughts (ABCD1234)',
      '--options',
      'runtime',
      '--entitlements',
      '/path/entitlements.plist',
      '--timestamp',
      '--keychain',
      '/tmp/sign.keychain-db',
      '--force',
      '/path/pythinker',
    ]);
  });

  it('omits --keychain when keychainPath is null but uses Developer ID otherwise', () => {
    const args = buildCodesignArgs({
      identity: 'Developer ID Application: Pythoughts (ABCD1234)',
      executable: '/path/pythinker',
      entitlementsPath: '/path/entitlements.plist',
      keychainPath: null,
    });
    expect(args).toContain('--entitlements');
    expect(args).not.toContain('--keychain');
  });
});
