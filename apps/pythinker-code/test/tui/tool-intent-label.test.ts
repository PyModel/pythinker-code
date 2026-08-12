import type { Event } from '@pythoughts/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  formatThinkingSpinnerLabel,
  setLiveIntent,
} from '#/tui/constant/rendering';
import { PythinkerTUI, type PythinkerTUIStartupInput } from '#/tui/pythinker-tui';

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

  it('removes control characters before display', () => {
    setLiveIntent('\u001B[31mcheck\n\u0007 failing test\u001B[0m');
    expect(formatThinkingSpinnerLabel(0)).toBe('check failing test…');
  });

  it('removes ST-terminated OSC hyperlinks before display', () => {
    setLiveIntent(
      '\u001B]8;;https://example.com\u001B\\click\u001B]8;;\u001B\\ done',
    );
    expect(formatThinkingSpinnerLabel(0)).toBe('click done…');
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
});
