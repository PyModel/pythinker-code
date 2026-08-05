import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPythinkerHarness } from '@pythoughts/pythinker-code-sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'pythinker-harness-config-home-'));
  const harness = createPythinkerHarness({ homeDir, identity: smokeIdentityFromEnv() });

  const initial = await harness.getConfig();
  if (Object.keys(initial.providers).length > 0) {
    throw new Error('expected empty providers for a fresh config home');
  }

  await harness.setConfig({
    defaultModel: 'pythinker-code/pythinker-for-coding',
    defaultThinking: true,
    defaultPermissionMode: 'manual',
    defaultPlanMode: false,
    providers: {
      'managed:kimi-code': {
        type: 'pythinker',
        baseUrl: 'https://api.pythinker.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
    },
    models: {
      'pythinker-code/pythinker-for-coding': {
        provider: 'managed:kimi-code',
        model: 'pythinker-for-coding',
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
      pythoughtsSearch: {
        baseUrl: 'https://api.pythinker.com/coding/v1/search',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
      pythoughtsFetch: {
        baseUrl: 'https://api.pythinker.com/coding/v1/fetch',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "pythinker-code/pythinker-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."managed:kimi-code"]',
    '[providers."managed:kimi-code".oauth]',
    '[models."pythinker-code/pythinker-for-coding"]',
    '[services.pythoughts_search]',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`missing ${expected} in written config`);
    }
  }

  const reloaded = await harness.getConfig({ reload: true });
  if (reloaded.defaultModel !== 'pythinker-code/pythinker-for-coding') {
    throw new Error('reloaded config did not preserve defaultModel');
  }
  if (reloaded.providers['managed:kimi-code']?.oauth?.key !== 'oauth/kimi-code') {
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
