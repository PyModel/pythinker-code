import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- plain .mjs build script, no type declarations
import { ensureNamespace } from '../scripts/ovsx-publish.mjs';

/**
 * Open VSX rejects a publish into a namespace that does not exist, which is why
 * the 0.12.0 release put 0.8.6 on the Marketplace but left Open VSX with no
 * version at all. The Marketplace has no namespace concept, so nothing upstream
 * of this catches it.
 */
describe('ensureNamespace', () => {
  it('creates the namespace before any publish is attempted', () => {
    const run = vi.fn();

    ensureNamespace('pymodel', run);

    expect(run).toHaveBeenCalledTimes(1);
    const [pkg, bin, args] = run.mock.calls[0] as [string, string, string[]];
    expect([pkg, bin]).toEqual(['ovsx', 'ovsx']);
    expect(args).toEqual(['create-namespace', 'pymodel']);
  });

  it('treats an existing namespace as success, so a re-run is safe', () => {
    const run = vi.fn(() => {
      throw new Error('Local ovsx exited with code 1:\nERROR  Namespace already exists: pymodel');
    });

    expect(() => ensureNamespace('pymodel', run)).not.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    const [, , args] = run.mock.calls[0] as unknown as [string, string, string[]];
    expect(args).toEqual(['create-namespace', 'pymodel']);
  });

  it('propagates a real failure instead of publishing into a broken namespace', () => {
    const run = vi.fn(() => {
      throw new Error('Local ovsx exited with code 1:\nERROR  Response code 401 (Unauthorized)');
    });

    expect(() => ensureNamespace('pymodel', run)).toThrow(/401/u);
  });
});
