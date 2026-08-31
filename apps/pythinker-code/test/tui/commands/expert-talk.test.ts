import { describe, expect, it, vi } from 'vitest';

import type {
  ExpertTalkStatusV1,
  ExpertTalkRunV1,
  ModelAlias,
  Session,
} from '@pymodel/pythinker-code-sdk';
import type { Component, Focusable } from '@pymodel/pi-tui';

import { handleExpertTalkCommand } from '#/tui/commands/expert-talk';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

function status(pair = true): ExpertTalkStatusV1 {
  return {
    version: 'expert_talk/v1',
    enabled: true,
    featureSource: 'env',
    config: {
      version: 'expert_talk/v1',
      resourceVersion: 'v1',
      pair: pair
        ? { fusionLeadModelId: 'lead', peerModelId: 'peer' }
        : undefined,
    },
    pairValidation: { state: pair ? 'valid' : 'unknown' },
  };
}

const ESC = String.fromCodePoint(27);
const RIGHT = `${ESC}[C`;

function model(provider: string, name: string, defaultEffort: string): ModelAlias {
  return {
    provider,
    model: name,
    maxContextSize: 128_000,
    capabilities: ['tool_use', 'thinking'],
    supportEfforts: ['low', 'high', 'max'],
    defaultEffort,
  };
}

type InputPanel = Component & Focusable;

function makeHost(initial = status(), engineV2 = true) {
  let current = initial;
  let mounted: InputPanel | undefined;
  const session = {
    getExpertTalkStatus: vi.fn(async () => current),
    configureExpertTalk: vi.fn(async (pair) => {
      current = {
        ...current,
        config: { ...current.config, resourceVersion: 'v2', pair },
        pairValidation: { state: 'valid' },
      };
      return current.config;
    }),
    clearExpertTalk: vi.fn(async () => {
      current = {
        ...current,
        config: { ...current.config, resourceVersion: 'v2', pair: undefined },
        pairValidation: { state: 'unknown' },
      };
      return current.config;
    }),
    armExpertTalk: vi.fn(async () => ({ armId: 'arm-1', armedAt: '2026-08-29T00:00:00Z' })),
    disarmExpertTalk: vi.fn(async () => {}),
    retryExpertTalkRun: vi.fn(async () => ({
      runId: 'retry-1',
      promptId: 'prompt-1',
      status: 'OPENING' as const,
      createdAt: '2026-08-29T00:00:00Z',
    })),
  };
  const host = {
    engineV2,
    session: session as unknown as Session,
    ensureSession: vi.fn(async () => session as unknown as Session),
    state: {
      appState: {
        availableModels: {
          lead: model('openai', 'gpt-test', 'high'),
          peer: model('local', 'glm-test', 'low'),
          noTools: { provider: 'local', model: 'plain', maxContextSize: 128_000 },
        },
      },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
    mountEditorReplacement: vi.fn((panel: InputPanel) => {
      mounted = panel;
    }),
    restoreEditor: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session, mounted: () => mounted };
}

describe('Expert Talk command', () => {
  it('arms the configured pair for the next message', async () => {
    const { host, session } = makeHost();

    await handleExpertTalkCommand(host, 'arm');

    expect(session.armExpertTalk).toHaveBeenCalledWith('v1');
    expect(host.setAppState).toHaveBeenCalledWith({
      expertTalkArmId: 'arm-1',
      expertTalkRunId: undefined,
    });
    expect(host.showNotice).toHaveBeenCalledWith(
      'Discussion armed',
      'Send the next message to start the exchange.',
    );
  });

  it('arms an existing pair when the command has no arguments', async () => {
    const { host, session } = makeHost();

    await handleExpertTalkCommand(host, '');

    expect(session.armExpertTalk).toHaveBeenCalledWith('v1');
  });

  it('uses off as the canonical disarm command', async () => {
    const armed = { ...status(), arm: { armId: 'arm-1', armedAt: '2026-08-29T00:00:00Z' } };
    const { host, session } = makeHost(armed);

    await handleExpertTalkCommand(host, 'off');

    expect(session.disarmExpertTalk).toHaveBeenCalledWith('arm-1');
    expect(host.setAppState).toHaveBeenCalledWith({ expertTalkArmId: undefined });
  });

  it('selects two distinct eligible models, configures them, and arms', async () => {
    const { host, session, mounted } = makeHost(status(false));

    await handleExpertTalkCommand(host, 'configure');
    expect(mounted()!.render(120).join('\n')).toContain('Select Fusion Lead');
    mounted()!.handleInput!(RIGHT);
    mounted()!.handleInput!('\r');
    expect(mounted()!.render(120).join('\n')).toContain('Select Peer Expert');
    expect(mounted()!.render(120).join('\n')).toContain('Fusion Lead: lead');
    mounted()!.handleInput!('\r');

    await vi.waitFor(() => {
      expect(session.configureExpertTalk).toHaveBeenCalledWith(
        {
          fusionLeadModelId: 'lead',
          peerModelId: 'peer',
          fusionLeadThinkingEffort: 'max',
          peerThinkingEffort: 'low',
        },
        'v1',
      );
    });
    expect(session.armExpertTalk).toHaveBeenCalledWith('v2');
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('rejects the legacy engine before creating a session', async () => {
    const { host } = makeHost(status(), false);
    host.session = undefined;

    await handleExpertTalkCommand(host, 'arm');

    expect(host.showError).toHaveBeenCalledWith('Discussion requires the v2 engine.');
    expect(host.ensureSession).not.toHaveBeenCalled();
  });

  it('resets the configured pair with its current version', async () => {
    const { host, session } = makeHost();

    await handleExpertTalkCommand(host, 'reset');

    expect(session.clearExpertTalk).toHaveBeenCalledWith('v1');
    expect(host.setAppState).toHaveBeenCalledWith({
      expertTalkArmId: undefined,
      expertTalkRunId: undefined,
    });
  });

  it('shows the provider disclosure before a direct retry', async () => {
    const initial = {
      ...status(),
      latestRun: {
        runId: 'failed-1',
        error: { retryable: true },
      } as ExpertTalkRunV1,
    };
    const { host, session, mounted } = makeHost(initial);

    await handleExpertTalkCommand(host, 'retry');

    expect(session.retryExpertTalkRun).not.toHaveBeenCalled();
    expect(mounted()!.render(120).join('\n')).toContain('at most 24 provider attempts');
    mounted()!.handleInput!('\r');
    await vi.waitFor(() => expect(session.retryExpertTalkRun).toHaveBeenCalledWith('failed-1'));
  });

  it('rejects removed manual stage commands', async () => {
    const { host } = makeHost();

    for (const action of ['review', 'finish', 'fuse']) {
      await handleExpertTalkCommand(host, action);
    }

    expect(host.showError).toHaveBeenCalledTimes(3);
    expect(host.showError).toHaveBeenLastCalledWith(
      'Usage: /discussion [help|status|configure|arm|off|cancel|retry|exchange|reset]',
    );
  });
});
