import type { Event } from '@pymodel/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  formatThinkingSpinnerLabel,
  setLiveIntent,
} from '#/tui/constant/rendering';
import { PythinkerTUI, type PythinkerTUIStartupInput } from '#/tui/pythinker-tui';

const SANITIZER_FIXTURES = [
  ['\u001B[31mred\u001B[0m', 'red'],
  ['\u001B]0;title\u0007visible', 'visible'],
  ['\u001B]0;title\u001B\\visible', 'visible'],
  ['check\n\u0007test', 'check test'],
] as const;

function makeStartupInput(): PythinkerTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      rewindFiles: undefined,
      yolo: false,
      auto: false,
      plan: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
    },
    tuiConfig: {
      theme: 'dark',
      layout: 'inline',
      copyFullResponse: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
    },
    version: '0.0.0-test',
    workDir: '/tmp/tool-intent-test',
  };
}

afterEach(() => {
  setLiveIntent(undefined);
});

describe('tool intent thinking label', () => {
  it('uses the live intent and restores the rotating label when cleared', () => {
    setLiveIntent('check failing test');
    expect(formatThinkingSpinnerLabel(0)).toBe('check failing test…');

    setLiveIntent(undefined);
    expect(formatThinkingSpinnerLabel(0)).toBe('thinking…');
  });

  it.each(SANITIZER_FIXTURES)('sanitizes intent %j', (raw, expected) => {
    setLiveIntent(raw);
    expect(formatThinkingSpinnerLabel(0)).toBe(`${expected}…`);
  });

  it('sets intent from a tool delta and clears it on the result', () => {
    const driver = new PythinkerTUI({} as never, makeStartupInput());
    const dispatch = (event: Event): void =>
      driver.sessionEventHandler.handleEvent(event, vi.fn());

    dispatch({
      type: 'tool.call.delta',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      toolCallId: 'call-1',
      name: 'echo',
      argumentsPart: '{"i":"check failing test","text":"hello"}',
    });
    expect(formatThinkingSpinnerLabel(0)).toBe('check failing test…');

    dispatch({
      type: 'tool.result',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      toolCallId: 'call-1',
      output: 'hello',
    });
    expect(formatThinkingSpinnerLabel(0)).toBe('thinking…');
  });

  it('clears a stale intent when the next tool call has no intent', () => {
    const driver = new PythinkerTUI({} as never, makeStartupInput());
    const dispatch = (event: Event): void =>
      driver.sessionEventHandler.handleEvent(event, vi.fn());

    dispatch({
      type: 'tool.call.started',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      toolCallId: 'call-1',
      name: 'echo',
      args: {},
      intent: 'check failing test',
    });
    dispatch({
      type: 'tool.call.started',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      toolCallId: 'call-2',
      name: 'StructuredOutput',
      args: {},
    });

    expect(formatThinkingSpinnerLabel(0)).toBe('thinking…');
  });

  it('clears the live intent when a step retries', () => {
    const driver = new PythinkerTUI({} as never, makeStartupInput());
    const dispatch = (event: Event): void =>
      driver.sessionEventHandler.handleEvent(event, vi.fn());

    dispatch({
      type: 'tool.call.started',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      toolCallId: 'call-1',
      name: 'echo',
      args: {},
      intent: 'check failing test',
    });
    dispatch({
      type: 'turn.step.retrying',
      agentId: 'main',
      sessionId: 'session-1',
      turnId: 1,
      step: 1,
      failedAttempt: 1,
      nextAttempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorName: 'Error',
      errorMessage: 'retry',
    });

    expect(formatThinkingSpinnerLabel(0)).toBe('thinking…');
  });
});
