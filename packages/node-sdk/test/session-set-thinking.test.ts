import { afterEach, describe, expect, it } from 'vitest';

import { createPythinkerHarness, type PythinkerError } from '#/index';

import { makeTempDir, removeTempDirs, waitForAgentWireEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session.setThinking', () => {
  it('sends config.update with the new thinking effort', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_thinking_wire', workDir });

      await session.setThinking('low');

      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'config.update',
          (event) => event['thinkingEffort'] === 'low',
        ),
      ).resolves.toMatchObject({
        type: 'config.update',
        thinkingEffort: 'low',
      });
    } finally {
      await harness.close();
    }
  });

  it('rejects empty thinking efforts', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_thinking_empty', workDir });

      await expect(session.setThinking('   ')).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'session.thinking_empty',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-thinking-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_thinking_closed', workDir });
      await session.close();

      await expect(session.setThinking('high')).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'session.closed',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });
});

describe('Session.setFastMode', () => {
  it('persists Fast mode and exposes provider eligibility in session status', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.setConfig({
        providers: {
          openai: {
            type: 'openai_responses',
            apiKey: 'test-key',
          },
        },
        models: {
          'openai/gpt-5.6-sol': {
            provider: 'openai',
            model: 'gpt-5.6-sol',
            maxContextSize: 272_000,
          },
        },
        defaultModel: 'openai/gpt-5.6-sol',
      });
      const session = await harness.createSession({
        id: 'ses_fast_wire',
        workDir,
        model: 'openai/gpt-5.6-sol',
      });

      await session.setFastMode(true);

      await expect(session.getStatus()).resolves.toMatchObject({
        fastMode: true,
        fastModeSupported: true,
      });
      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'config.update',
          (event) => event['fastMode'] === true,
        ),
      ).resolves.toMatchObject({
        type: 'config.update',
        fastMode: true,
      });
    } finally {
      await harness.close();
    }
  });

  it('rejects enabling Fast mode for an unsupported model', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.setConfig({
        providers: {
          openai: {
            type: 'openai_responses',
            apiKey: 'test-key',
          },
        },
        models: {
          'openai/gpt-5.4-mini': {
            provider: 'openai',
            model: 'gpt-5.4-mini',
            maxContextSize: 128_000,
          },
        },
        defaultModel: 'openai/gpt-5.4-mini',
      });
      const session = await harness.createSession({
        id: 'ses_fast_unsupported',
        workDir,
        model: 'openai/gpt-5.4-mini',
      });

      await expect(session.setFastMode(true)).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'request.invalid',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects non-boolean Fast mode values', async () => {
    const homeDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-home-');
    const workDir = await makeTempDir(tempDirs, 'pythinker-sdk-fast-work-');
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_fast_invalid', workDir });

      await expect(session.setFastMode('on' as never)).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'request.invalid',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });
});
