import { describe, expect, it } from 'vitest';

import type { ExecutableTool } from '../../src/loop/types';
import {
  extractIntentFromArgs,
  injectIntentIntoTools,
  INTENT_FIELD,
  INTENT_MAX_LENGTH,
  INTENT_OMIT_TOOLS,
  sanitizeIntent,
} from '../../src/loop/tool-intent';

const SANITIZER_FIXTURES = [
  ['\u001B[31mred\u001B[0m', 'red'],
  ['\u001B]0;title\u0007visible', 'visible'],
  ['\u001B]0;title\u001B\\visible', 'visible'],
  ['check\n\u0007test', 'check test'],
] as const;

function makeTool(
  name = 'test',
  parameters?: Record<string, unknown>,
): ExecutableTool {
  const toolParameters = parameters ?? {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  };
  return {
    name,
    description: 'Test tool.',
    parameters: toolParameters,
    resolveExecution: () => ({
      approvalRule: name,
      execute: () => Promise.resolve({ output: 'ok' }),
    }),
  };
}

describe('tool intent schema injection', () => {
  it('clones the tool and schema with intent first without mutating the original', () => {
    const parameters = {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    };
    const originalValue = structuredClone(parameters);
    const tool = makeTool('test', parameters);

    const [injected] = injectIntentIntoTools([tool]);

    expect(injected).not.toBe(tool);
    expect(injected?.parameters).not.toBe(parameters);
    expect(tool.parameters).toBe(parameters);
    expect(parameters).toEqual(originalValue);
    const properties = injected?.parameters['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)[0]).toBe(INTENT_FIELD);
    expect(injected?.parameters['required']).toEqual([INTENT_FIELD, 'value']);
  });

  it('does not duplicate intent in required', () => {
    const tool = makeTool('test', {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: [INTENT_FIELD],
    });

    const [injected] = injectIntentIntoTools([tool]);

    expect(injected?.parameters['required']).toEqual([INTENT_FIELD]);
  });

  it('returns omitted tools unchanged', () => {
    const omittedTools = INTENT_OMIT_TOOLS as Set<string>;
    omittedTools.add('omitted');
    try {
      const tool = makeTool('omitted');
      expect(injectIntentIntoTools([tool])[0]).toBe(tool);
    } finally {
      omittedTools.delete('omitted');
    }
  });

  it('returns StructuredOutput unchanged', () => {
    const tool = makeTool('StructuredOutput');
    expect(injectIntentIntoTools([tool])[0]).toBe(tool);
  });

  it('returns tools with an intent collision unchanged', () => {
    const tool = makeTool('collision', {
      type: 'object',
      properties: { i: { type: 'number' } },
    });
    expect(injectIntentIntoTools([tool])[0]).toBe(tool);
  });

  it('returns tools with a non-object root unchanged', () => {
    const tool = makeTool('array-root', [] as unknown as Record<string, unknown>);
    expect(injectIntentIntoTools([tool])[0]).toBe(tool);
  });
});

describe('tool intent extraction', () => {
  it('removes a string intent and returns its sanitized value', () => {
    expect(extractIntentFromArgs({ i: '  check   test  ', value: 1 })).toEqual({
      args: { value: 1 },
      intent: 'check test',
    });
  });

  it.each([1, null])('removes a non-string intent value %j', (intent) => {
    expect(extractIntentFromArgs({ i: intent, value: 1 })).toEqual({
      args: { value: 1 },
      intent: undefined,
    });
  });

  it('passes non-object args through', () => {
    const args = ['value'];
    expect(extractIntentFromArgs(args)).toEqual({ args, intent: undefined });
  });

  it('passes args without a string intent through', () => {
    const args = { value: 1 };
    expect(extractIntentFromArgs(args)).toEqual({ args, intent: undefined });
  });
});

describe('tool intent sanitization', () => {
  it.each(SANITIZER_FIXTURES)('sanitizes intent %j', (raw, expected) => {
    expect(sanitizeIntent(raw)).toBe(expected);
  });

  it('caps the result by code points', () => {
    // U+1F642 SLIGHTLY SMILING FACE. Must stay a surrogate pair: this test proves
    // the cap counts code points rather than UTF-16 code units.
    const surrogatePair = String.fromCodePoint(0x1f642);
    const sanitized = sanitizeIntent(surrogatePair.repeat(INTENT_MAX_LENGTH + 1));
    expect(typeof sanitized).toBe('string');
    expect(Array.from(sanitized as string)).toHaveLength(INTENT_MAX_LENGTH);
  });

  it('returns undefined for an empty result', () => {
    expect(sanitizeIntent('\u001B[31m\u001B[0m\u0007')).toBeUndefined();
  });
});
