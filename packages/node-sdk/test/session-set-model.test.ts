import { join } from 'node:path';

import { FileTokenStorage, type TokenInfo } from '@pythoughts/pythinker-code-oauth';
import { afterEach, describe, expect, it } from 'vitest';

import { createPythinkerHarness, type PythinkerError, type PythinkerHarness } from '#/index';
import { makeTempDir, removeTempDirs, waitForAgentWireEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

function freshToken(): TokenInfo {
  return {
    accessToken: 'oauth-access-token',
    refreshToken: 'oauth-refresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scope: '',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
}

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session.setModel', () => {
  it('updates the runtime model and sends config.update with the resolved model', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({
        id: 'ses_model_wire',
        workDir,
        model: 'initial-model',
      });

      await session.setModel('next-model');

      await expect(session.getStatus()).resolves.toMatchObject({ model: 'next-model' });
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'next-model',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'next-model',
      });
      expect(configEvent).not.toHaveProperty('provider');
    } finally {
      await harness.close();
    }
  });

  it('resolves managed OAuth aliases before updating the runtime provider', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-work-');
    await new FileTokenStorage(join(homeDir, 'credentials')).save('pythinker-code', freshToken());
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.setConfig({
        providers: {
          'managed:pythinker-code': {
            type: 'pythinker',
            baseUrl: 'https://api.pythinker.com/coding/v1',
            apiKey: '',
            oauth: { storage: 'file', key: 'oauth/pythinker-code' },
          },
        },
        models: {
          'pythinker-code/initial': {
            provider: 'managed:pythinker-code',
            model: 'pythinker-initial',
            maxContextSize: 262144,
          },
          'pythinker-code/pythinker-for-coding': {
            provider: 'managed:pythinker-code',
            model: 'pythinker-for-coding',
            maxContextSize: 262144,
          },
        },
        defaultModel: 'pythinker-code/initial',
      });
      const session = await harness.createSession({
        id: 'ses_model_oauth_wire',
        workDir,
        model: 'pythinker-code/initial',
      });

      await session.setModel('pythinker-code/pythinker-for-coding');

      await expect(session.getStatus()).resolves.toMatchObject({
        model: 'pythinker-code/pythinker-for-coding',
      });
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'pythinker-code/pythinker-for-coding',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'pythinker-code/pythinker-for-coding',
      });
      expect(configEvent).not.toHaveProperty('provider');
    } finally {
      await harness.close();
    }
  });

  it('rejects empty model names', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({ id: 'ses_model_empty', workDir });

      await expect(session.setModel('   ')).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'session.model_empty',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-model-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await configureLocalProvider(harness);
      const session = await harness.createSession({ id: 'ses_model_closed', workDir });
      await session.close();

      await expect(session.setModel('next-model')).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'session.closed',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });
});

async function configureLocalProvider(harness: PythinkerHarness): Promise<void> {
  await harness.setConfig({
    providers: {
      local: {
        type: 'pythinker',
        apiKey: 'sk-test',
      },
    },
    models: {
      'initial-model': {
        provider: 'local',
        model: 'initial-model',
        maxContextSize: 262144,
      },
      'next-model': {
        provider: 'local',
        model: 'next-model',
        maxContextSize: 262144,
      },
    },
    defaultProvider: 'local',
  });
}
