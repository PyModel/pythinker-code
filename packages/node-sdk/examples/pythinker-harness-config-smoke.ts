import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPythinkerHarness } from '@pymodel/pythinker-code-sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'pythinker-harness-config-home-'));
  const harness = createPythinkerHarness({ homeDir, identity: smokeIdentityFromEnv() });

  const initial = await harness.getConfig();
  if (Object.keys(initial.providers).length > 0) {
    throw new Error('expected empty providers for a fresh config home');
  }

  await harness.setConfig({
    defaultModel: 'pythinker-code/kimi-for-coding',
    thinking: { enabled: true },
    defaultPermissionMode: 'manual',
    defaultPlanMode: false,
    providers: {
      'managed:pythinker-code': {
        type: 'pythinker',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
    },
    models: {
      'pythinker-code/kimi-for-coding': {
        provider: 'managed:pythinker-code',
        model: 'kimi-for-coding',
        maxContextSize: 262144,
        capabilities: ['image_in', 'thinking', 'video_in'],
        displayName: 'Pythinker for Coding',
      },
    },
    loopControl: {
      maxRetriesPerStep: 3,
      maxRalphIterations: 0,
      reservedContextSize: 50000,
      compactionTriggerRatio: 0.85,
    },
    services: {
      pymodelSearch: {
        baseUrl: 'https://api.kimi.com/coding/v1/search',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
      pymodelFetch: {
        baseUrl: 'https://api.kimi.com/coding/v1/fetch',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "pythinker-code/kimi-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."managed:pythinker-code"]',
    '[providers."managed:pythinker-code".oauth]',
    '[models."pythinker-code/kimi-for-coding"]',
    '[services.pymodel_search]',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`missing ${expected} in written config`);
    }
  }

  const reloaded = await harness.getConfig({ reload: true });
  if (reloaded.defaultModel !== 'pythinker-code/kimi-for-coding') {
    throw new Error('reloaded config did not preserve defaultModel');
  }
  if (reloaded.providers['managed:pythinker-code']?.oauth?.key !== 'oauth/pythinker-code') {
    throw new Error('reloaded config did not preserve provider oauth');
  }

  process.stdout.write(`config: ${configPath}\n`);
  process.stdout.write('ok\n');
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
