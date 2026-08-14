

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = import.meta.dirname;

const daemonSrc = resolve(here, '..', 'src');

describe('packages/server/src anti-corruption', () => {
  it('has zero @pymodel/pythinker-code-sdk / PythinkerHarness / createRPC / SDKRpcClient references', () => {

    const out = execSync(
      `grep -rE "@pymodel/pythinker-code-sdk|PythinkerHarness\\b|createRPC\\b|SDKRpcClient\\b" "${daemonSrc}" || true`,
      { encoding: 'utf8' },
    ).trim();
    expect(out).toBe('');
  });

  it('imports shared filesystem, file store, logger, and workspace services from @pymodel/agent-core', () => {
    const out = execSync(
      `grep -rE '["'"'"']#/services/(fileStore|fs|logger|workspace)(/|["'"'"'])' "${daemonSrc}" || true`,
      { encoding: 'utf8' },
    ).trim();
    expect(out).toBe('');
  });
});
