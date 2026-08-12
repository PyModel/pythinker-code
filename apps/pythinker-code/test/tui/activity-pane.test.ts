import chalk from 'chalk';
import type { Event } from '@pythoughts/pythinker-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import { DynamicWorkflowMissionControlComponent } from '#/tui/components/messages/dynamic-workflow-mission-control';
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
} from '#/tui/constant/rendering';
import type { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { PythinkerTUI, type PythinkerTUIStartupInput, type TUIState } from '#/tui/pythinker-tui';
import { currentTheme, darkColors } from '#/tui/theme';

interface ActivityDriver {
  state: TUIState;
  sessionEventHandler: SessionEventHandler;
  updateActivityPane(): void;
}

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

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
    workDir: '/tmp/proj-a',
  };
}

function makeDriverWithTerminalProgress(): {
  driver: ActivityDriver;
  state: TUIState;
  setProgress: ReturnType<typeof vi.fn<(active: boolean) => void>>;
} {
  const setProgress = vi.fn<(active: boolean) => void>();
  const driver = new PythinkerTUI({} as never, makeStartupInput()) as unknown as ActivityDriver;
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  driver.state.terminal = { columns: 80, setProgress } as unknown as TUIState['terminal'];
  driver.state.terminalState.supportsProgress = true;
  return { driver, state: driver.state, setProgress };
}

function startDynamicWorkflow(
  driver: ActivityDriver,
  state: TUIState,
): DynamicWorkflowMissionControlComponent {
  const handler = driver.sessionEventHandler.subAgentEventHandler;
  handler.handleDynamicWorkflowToolCallStarted('call_dynamic_workflow', {
    description: 'Review changed files',
    items: ['Review changed files'],
  });
  handler.handleLifecycleEvent({
    type: 'subagent.spawned',
    subagentId: 'agent-1',
    subagentName: 'coder',
    parentToolCallId: 'call_dynamic_workflow',
    description: 'Review changed files #1 (coder)',
    dynamicWorkflowIndex: 1,
    runInBackground: false,
  } as Parameters<typeof handler.handleLifecycleEvent>[0]);
  handler.handleLifecycleEvent({
    type: 'subagent.started',
    subagentId: 'agent-1',
  } as Parameters<typeof handler.handleLifecycleEvent>[0]);

  const missionControl = state.transcriptContainer.children.find(
    (child): child is DynamicWorkflowMissionControlComponent =>
      child instanceof DynamicWorkflowMissionControlComponent,
  );
  if (missionControl === undefined) throw new Error('expected Dynamic Workflow mission control');
  return missionControl;
}

describe('updateActivityPane terminal progress', () => {
  it.each(['waiting', 'tool'] as const)('shows a labeled primary spinner while %s', (mode) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    try {
      const { driver, state } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode };

      driver.updateActivityPane();

      const spinner = state.activitySpinner?.instance;
      if (spinner === undefined) throw new Error('expected activity spinner');
      expect(strip(spinner.renderInline())).toBe(`⠋ ${formatThinkingSpinnerLabel()}`);
      expect(spinner.renderInline().startsWith(currentTheme.fg('primary', '⠋'))).toBe(true);
      spinner.stop();
    } finally {
      chalk.level = previousLevel;
      vi.useRealTimers();
    }
  });

  it('toggles terminal progress when the activity pane enters and leaves work mode', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();

      state.livePane = { ...state.livePane, mode: 'waiting' };
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(1);
      expect(setProgress).toHaveBeenLastCalledWith(true);
      expect(state.terminalState.progressActive).toBe(true);

      state.livePane = { ...state.livePane, mode: 'idle' };
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(2);
      expect(setProgress).toHaveBeenLastCalledWith(false);
      expect(state.terminalState.progressActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never emits terminal progress when the terminal does not support OSC 9;4', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();
      state.terminalState.supportsProgress = false;

      state.livePane = { ...state.livePane, mode: 'waiting' };
      driver.updateActivityPane();
      state.livePane = { ...state.livePane, mode: 'idle' };
      driver.updateActivityPane();

      expect(setProgress).not.toHaveBeenCalled();
      expect(state.terminalState.progressActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps compaction visible as terminal progress even though the pane is hidden', () => {
    const { driver, state, setProgress } = makeDriverWithTerminalProgress();
    state.appState.isCompacting = true;
    state.appState.streamingPhase = 'waiting';

    driver.updateActivityPane();
    driver.updateActivityPane();

    expect(setProgress).toHaveBeenCalledTimes(1);
    expect(setProgress).toHaveBeenLastCalledWith(true);

    state.appState.isCompacting = false;
    state.appState.streamingPhase = 'idle';
    driver.updateActivityPane();

    expect(setProgress).toHaveBeenCalledTimes(2);
    expect(setProgress).toHaveBeenLastCalledWith(false);
  });

  it('keeps terminal progress active without showing a thinking spinner', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode: 'idle' };
      state.appState.streamingPhase = 'thinking';

      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(1);
      expect(setProgress).toHaveBeenLastCalledWith(true);
      expect(state.activitySpinner).toBeNull();
      expect(state.activityContainer.children).toHaveLength(0);

      state.appState.streamingPhase = 'idle';
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(2);
      expect(setProgress).toHaveBeenLastCalledWith(false);
      expect(state.activitySpinner).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the one host loader into Dynamic Workflow without creating a component timer', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode: 'tool' };
      driver.updateActivityPane();
      const timersBeforeMissionControl = vi.getTimerCount();
      const missionControl = startDynamicWorkflow(driver, state);
      expect(vi.getTimerCount()).toBe(timersBeforeMissionControl);

      expect(setProgress).toHaveBeenCalledTimes(1);
      expect(setProgress).toHaveBeenLastCalledWith(true);
      expect(state.activitySpinner).not.toBeNull();
      expect(state.activityContainer.children).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(timersBeforeMissionControl);
      const output = strip(missionControl.render(100).join('\n'));
      expect(output).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Orchestrating/);
      expect(output).not.toContain(formatThinkingSpinnerLabel());

      state.activitySpinner?.instance.stop();
      driver.sessionEventHandler.clearDynamicWorkflowMissionControls();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shimmers verb labels independently of the repeating spinner frame', () => {
    vi.useFakeTimers();
    const previousLevel = chalk.level;
    chalk.level = 3;
    try {
      vi.setSystemTime(0);
      const { driver, state } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode: 'idle' };
      state.appState.streamingPhase = 'composing';
      driver.updateActivityPane();

      const spinner = state.activitySpinner?.instance;
      if (spinner === undefined) throw new Error('expected activity spinner');
      const before = spinner.renderInline();

      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS * BRAILLE_SPINNER_FRAMES.length);
      const after = spinner.renderInline();

      expect(strip(after)).toBe(strip(before));
      expect(after).not.toBe(before);

      spinner.stop();
    } finally {
      chalk.level = previousLevel;
      vi.useRealTimers();
    }
  });

  it('keeps terminal workflow output static while the host loader remains owned by the activity pane', () => {
    vi.useFakeTimers();
    try {
      const { driver, state } = makeDriverWithTerminalProgress();
      const missionControl = startDynamicWorkflow(driver, state);
      state.livePane = { ...state.livePane, mode: 'tool' };
      driver.updateActivityPane();
      const hostTimerCount = vi.getTimerCount();
      driver.sessionEventHandler.subAgentEventHandler.handleDynamicWorkflowToolResult(
        'call_dynamic_workflow',
        {
          tool_call_id: 'call_dynamic_workflow',
          output: [
            '<dynamic_workflow_result>',
            '<summary>completed: 1, failed: 0, aborted: 0</summary>',
            '<subagent outcome="completed">Done</subagent>',
            '</dynamic_workflow_result>',
          ].join('\n'),
          is_error: false,
        },
        false,
      );

      driver.updateActivityPane();

      expect(state.activitySpinner).not.toBeNull();
      expect(state.activityContainer.children).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(hostTimerCount);
      const output = strip(missionControl.render(100).join('\n'));
      expect(output).toContain('✓ Completed');
      expect(output).not.toMatch(/[◐◓◑◒] Orchestrating/);

      state.activitySpinner?.instance.stop();
      driver.sessionEventHandler.clearDynamicWorkflowMissionControls();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['failure', 'cancellation', 'cleanup'] as const)(
    'keeps the host loader running after Dynamic Workflow %s',
    (outcome) => {
      vi.useFakeTimers();
      try {
        const { driver, state } = makeDriverWithTerminalProgress();
        state.livePane = { ...state.livePane, mode: 'tool' };
        driver.updateActivityPane();
        const hostLoader = state.activitySpinner?.instance;
        if (hostLoader === undefined) throw new Error('expected host activity loader');
        const hostTimerCount = vi.getTimerCount();
        startDynamicWorkflow(driver, state);

        if (outcome === 'failure') {
          driver.sessionEventHandler.subAgentEventHandler.handleDynamicWorkflowToolResult(
            'call_dynamic_workflow',
            {
              tool_call_id: 'call_dynamic_workflow',
              output: 'provider request failed',
              is_error: true,
            },
            true,
          );
        } else if (outcome === 'cancellation') {
          driver.sessionEventHandler.subAgentEventHandler.markActiveDynamicWorkflowsCancelled();
        } else {
          driver.sessionEventHandler.clearDynamicWorkflowMissionControls();
        }
        driver.updateActivityPane();

        expect(state.activitySpinner?.instance).toBe(hostLoader);
        expect(vi.getTimerCount()).toBe(hostTimerCount);
        hostLoader.stop();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    [
      'turn',
      (driver: ActivityDriver) => {
        driver.sessionEventHandler.handleEvent(
          { type: 'turn.started', agentId: 'main', sessionId: 'ses-1', turnId: 2 } as Event,
          () => {},
        );
      },
    ],
    [
      'error',
      (driver: ActivityDriver) => {
        driver.sessionEventHandler.handleEvent(
          {
            type: 'error',
            agentId: 'main',
            sessionId: 'ses-1',
            code: 'provider.connection_error',
            message: 'Provider disconnected',
            retryable: false,
          } as Event,
          () => {},
        );
      },
    ],
  ] as const)('leaves active Mission Control static during %s cleanup', (_kind, cleanup) => {
    vi.useFakeTimers();
    try {
      const { driver, state } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode: 'tool' };
      driver.updateActivityPane();
      const missionControl = startDynamicWorkflow(driver, state);
      expect(strip(missionControl.render(100).join('\n'))).toMatch(
        /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Orchestrating/,
      );

      cleanup(driver);
      driver.updateActivityPane();

      const output = strip(missionControl.render(100).join('\n'));
      expect(output).toContain('– Cancelled');
      expect(output).not.toMatch(/[◐◓◑◒] Orchestrating/);
      state.activitySpinner?.instance.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
