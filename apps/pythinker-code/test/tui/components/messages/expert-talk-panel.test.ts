import { describe, expect, it } from 'vitest';

import type { ExpertTalkRunV1, ExpertTalkStatusV1 } from '@pymodel/pythinker-code-sdk';

import {
  buildExpertTalkExchangeLines,
  buildExpertTalkStatusLines,
} from '#/tui/components/messages/expert-talk-panel';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('Expert Talk status panel', () => {
  it('renders the ordered pair, live phase, limits, and trust boundary', () => {
    const status = {
      version: 'expert_talk/v1',
      enabled: true,
      featureSource: 'env',
      config: {
        version: 'expert_talk/v1',
        resourceVersion: 'v2',
        pair: { fusionLeadModelId: 'lead', peerModelId: 'peer' },
      },
      pairValidation: { state: 'valid' },
      activeRun: {
        schemaVersion: 1,
        version: 'expert_talk/v1',
        runId: 'run-1',
        sessionId: 'session-1',
        turnId: 1,
        promptId: 'prompt-1',
        status: 'REVIEWING',
        prompt: 'Decide',
        modalities: [],
        createdAt: '2026-08-29T00:00:00Z',
        startedAt: '2026-08-29T00:00:00Z',
        updatedAt: '2026-08-29T00:00:01Z',
        bindings: [
          { role: 'fusion_lead', effectiveModelId: 'lead' },
          { role: 'peer', effectiveModelId: 'peer' },
        ],
        artifacts: {
          leadOpening: { status: 'completed', text: 'Lead opening' },
          peerOpening: { status: 'completed', text: 'Peer opening' },
        },
        revision: 2,
      },
    } as unknown as ExpertTalkStatusV1;

    const output = buildExpertTalkStatusLines(status, {
      lead: { provider: 'openai', model: 'gpt-test', displayName: 'GPT Test', maxContextSize: 1 },
      peer: { provider: 'local', model: 'glm-test', displayName: 'GLM Test', maxContextSize: 1 },
    }).map(strip).join('\n');

    expect(output).toContain('Architect GPT Test ↔ Builder GLM Test');
    expect(output).toContain('✓ Independent opinions');
    expect(output).toContain('◐ Architect reviews Builder');
    expect(output).toContain('○ Fusion');
    expect(output).toContain('at most 56 provider attempts');
    expect(output).toContain('read-only tools');
  });

  it('renders two columns above a full-width Fusion row and stacks on narrow screens', () => {
    const run = {
      status: 'COMPLETED',
      bindings: [
        { role: 'fusion_lead', effectiveModelId: 'lead' },
        { role: 'peer', effectiveModelId: 'peer' },
      ],
      artifacts: {
        leadOpening: {
          status: 'completed',
          text: 'Model one opening',
          startedAt: '2026-08-30T12:00:00.000Z',
          endedAt: '2026-08-30T12:00:02.000Z',
          usage: { inputOther: 1024, inputCacheRead: 512, inputCacheCreation: 0, output: 600 },
          toolCallCount: 1,
        },
        peerOpening: { status: 'completed', text: 'Model two opening' },
        leadReview: { status: 'completed', text: 'Model one review' },
        fusion: { status: 'completed', text: 'Fused final answer' },
      },
    } as unknown as ExpertTalkRunV1;
    const models = {
      lead: { provider: 'openai', model: 'gpt-test', displayName: 'GPT Test', maxContextSize: 1 },
      peer: { provider: 'local', model: 'glm-test', displayName: 'GLM Test', maxContextSize: 1 },
    };

    const wide = buildExpertTalkExchangeLines(run, models, 100).map(strip);
    expect(wide.some((line) => line.includes('Architect') && line.includes(' │ ') && line.includes('Builder'))).toBe(true);
    expect(wide.join('\n')).toContain('TIME 2.0s  TOKENS IN 1.5k  OUT 600  TPS 300');
    expect(wide.join('\n')).toContain('TOOLS 1');
    expect(wide.findIndex((line) => line.includes('FUSION'))).toBeGreaterThan(
      wide.findIndex((line) => line.includes('Builder')),
    );
    expect(wide.join('\n')).toContain('Fused final answer');
    expect(wide.join('\n')).toContain('⧉ FUSION');
    expect(wide.join('\n')).toContain('ARCHITECT REVIEW OF BUILDER');
    expect(wide.join('\n')).not.toContain('Model two review');

    const narrow = buildExpertTalkExchangeLines(run, models, 60).map(strip);
    const model1 = narrow.findIndex((line) => line.includes('Architect'));
    const model2 = narrow.findIndex((line) => line.includes('Builder'));
    const fusion = narrow.findIndex((line) => line.includes('FUSION'));
    expect(narrow.some((line) => line.includes(' │ '))).toBe(false);
    expect(model2).toBeGreaterThan(model1);
    expect(fusion).toBeGreaterThan(model2);
    expect(narrow.join('\n')).toContain('fresh Architect inference');
  });

  it('renders live model answer, thinking, and tool activity', () => {
    const run = {
      status: 'OPENING',
      bindings: [
        { role: 'fusion_lead', effectiveModelId: 'lead' },
        { role: 'peer', effectiveModelId: 'peer' },
      ],
      artifacts: {},
      progress: {
        leadOpening: {
          text: '# Architect draft',
          thinking: 'Checking the evidence.',
          tools: [{ id: 'tool-1', name: 'Read' }],
          startedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    } as unknown as ExpertTalkRunV1;
    const output = buildExpertTalkExchangeLines(run, {
      lead: { provider: 'openai', model: 'gpt-test', displayName: 'GPT Test', maxContextSize: 1 },
      peer: { provider: 'local', model: 'glm-test', displayName: 'GLM Test', maxContextSize: 1 },
    }, 100).map(strip).join('\n');

    expect(output).toContain('Architect draft');
    expect(output).not.toContain('# Architect draft');
    expect(output).toContain('▹ Checking the evidence.');
    expect(output).toContain('▸ Read');
  });

  it('marks review as skipped after direct Fusion', () => {
    const run = {
      status: 'COMPLETED',
      bindings: [
        { role: 'fusion_lead', effectiveModelId: 'lead' },
        { role: 'peer', effectiveModelId: 'peer' },
      ],
      artifacts: {
        leadOpening: { status: 'completed', text: 'Architect opinion' },
        peerOpening: { status: 'completed', text: 'Builder opinion' },
        fusion: { status: 'completed', text: 'Fusion answer' },
      },
    } as unknown as ExpertTalkRunV1;
    const status = {
      version: 'expert_talk/v1',
      enabled: true,
      featureSource: 'env',
      config: { version: 'expert_talk/v1', resourceVersion: 'v2' },
      pairValidation: { state: 'valid' },
      latestRun: run,
    } as unknown as ExpertTalkStatusV1;
    const models = {
      lead: { provider: 'openai', model: 'gpt-test', maxContextSize: 1 },
      peer: { provider: 'local', model: 'glm-test', maxContextSize: 1 },
    };

    const phases = buildExpertTalkStatusLines(status, models).map(strip).join('\n');
    const exchange = buildExpertTalkExchangeLines(run, models).map(strip).join('\n');

    expect(phases).toContain('– Architect reviews Builder');
    expect(phases).toContain('✓ Fusion');
    expect(exchange).not.toContain('ARCHITECT REVIEW OF BUILDER');
  });
});
