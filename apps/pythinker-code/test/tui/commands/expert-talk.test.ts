import { describe, expect, it, vi } from 'vitest';

import type {
  ExpertTalkStatusV1,
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

function readyStatus(stage: 'OPINIONS_READY' | 'REVIEW_READY'): ExpertTalkStatusV1 {
  const base = status();
  const run = {
    schemaVersion: 1,
    version: 'expert_talk/v1',
    runId: 'run-1',
    sessionId: 'session-1',
    turnId: 1,
    promptId: 'prompt-1',
    status: stage,
    prompt: 'Decide',
    modalities: [],
    createdAt: '2026-08-30T00:00:00Z',
    startedAt: '2026-08-30T00:00:00Z',
    updatedAt: '2026-08-30T00:00:01Z',
    bindings: [
      { role: 'fusion_lead', effectiveModelId: 'lead' },
      { role: 'peer', effectiveModelId: 'peer' },
    ],
    artifacts: {
      leadOpening: { status: 'completed', text: 'Architect opinion' },
      peerOpening: { status: 'completed', text: 'Builder opinion' },
      leadReview: stage === 'REVIEW_READY'
        ? { status: 'completed', text: 'Architect review' }
        : undefined,
    },
    revision: 3,
  } as unknown as NonNullable<ExpertTalkStatusV1['activeRun']>;
  return { ...base, activeRun: run, latestRun: run };
}

function model(provider: string, name: string): ModelAlias {
  return {
    provider,
    model: name,
    maxContextSize: 128_000,
    capabilities: ['tool_use'],
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
    reviewExpertTalkRun: vi.fn(async () => current.activeRun!),
    finishExpertTalkRun: vi.fn(async () => current.activeRun!),
    fuseExpertTalkRun: vi.fn(async () => current.activeRun!),
  };
  const host = {
    engineV2,
    session: session as unknown as Session,
    ensureSession: vi.fn(async () => session as unknown as Session),
    state: {
      appState: {
        availableModels: {
          lead: model('openai', 'gpt-test'),
          peer: model('local', 'glm-test'),
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

describe('Discussion command', () => {
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

  it('selects two distinct eligible models, configures them, and arms', async () => {
    const { host, session, mounted } = makeHost(status(false));

    await handleExpertTalkCommand(host, 'configure');
    expect(mounted()!.render(120).join('\n')).toContain('Select Architect');
    mounted()!.handleInput!('\r');
    expect(mounted()!.render(120).join('\n')).toContain('Select Builder');
    expect(mounted()!.render(120).join('\n')).toContain('Architect: lead');
    mounted()!.handleInput!('\r');

    await vi.waitFor(() => {
      expect(session.configureExpertTalk).toHaveBeenCalledWith(
        { fusionLeadModelId: 'lead', peerModelId: 'peer' },
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

  it('runs review, finish, and Fusion only from explicit commands', async () => {
    const reviewContext = makeHost(readyStatus('OPINIONS_READY'));

    await handleExpertTalkCommand(reviewContext.host, 'review');

    expect(reviewContext.session.reviewExpertTalkRun).toHaveBeenCalledWith('run-1');

    const finishContext = makeHost(readyStatus('REVIEW_READY'));

    await handleExpertTalkCommand(finishContext.host, 'finish');

    expect(finishContext.session.finishExpertTalkRun).toHaveBeenCalledWith('run-1');

    const fusionContext = makeHost(readyStatus('REVIEW_READY'));

    await handleExpertTalkCommand(fusionContext.host, 'fuse');

    expect(fusionContext.session.fuseExpertTalkRun).toHaveBeenCalledWith('run-1');
  });
});
