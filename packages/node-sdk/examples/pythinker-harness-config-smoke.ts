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
      'moonshot-cn': {
        type: 'pythinker',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'sk-config-smoke',
      },
    },
    models: {
      'pythinker-code/pythinker-for-coding': {
        provider: 'moonshot-cn',
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
        baseUrl: 'https://api.moonshot.cn/v1/search',
        apiKey: 'sk-config-smoke',
      },
      pythoughtsFetch: {
        baseUrl: 'https://api.moonshot.cn/v1/fetch',
        apiKey: 'sk-config-smoke',
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "pythinker-code/pythinker-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."moonshot-cn"]',
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
  if (reloaded.providers['moonshot-cn']?.apiKey !== 'sk-config-smoke') {
    throw new Error('reloaded config did not preserve the provider api key');
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
