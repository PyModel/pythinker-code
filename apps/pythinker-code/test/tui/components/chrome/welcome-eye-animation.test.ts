import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { WelcomeLogoEyeAnimator, welcomeLogoAnimationEnabled } from '#/tui/components/chrome/welcome-logo-animation';
import { LOGO_EYES_OPEN } from '#/tui/components/chrome/pythinker-logo';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { setRainbowColors } from '#/tui/easter-eggs/rainbow-colors';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';
import type { AppState } from '#/tui/types';

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'pythinker-k2',
  permissionMode: 'manual',
thinkingLevel: 'off',
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  dynamicWorkflowMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  statusLine: DEFAULT_STATUS_LINE_CONFIG,
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

describe('WelcomeComponent eye animation', () => {
  const previousTerm = process.env['TERM'];
  const previousNoAnim = process.env['PYTHINKER_NO_ANIMATION'];

  beforeEach(() => {
    vi.useFakeTimers();
    process.env['TERM'] = 'xterm-256color';
    delete process.env['PYTHINKER_NO_ANIMATION'];
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setRainbowColors(undefined);
    currentTheme.setPalette(darkColors);
  });

  afterEach(() => {
    vi.useRealTimers();
    setRainbowColors(undefined);
    if (previousTerm === undefined) delete process.env['TERM'];
    else process.env['TERM'] = previousTerm;
    if (previousNoAnim === undefined) delete process.env['PYTHINKER_NO_ANIMATION'];
    else process.env['PYTHINKER_NO_ANIMATION'] = previousNoAnim;
  });

  it('runs the installer blink cadence on the animator', () => {
    expect(welcomeLogoAnimationEnabled()).toBe(true);
    const states: string[] = [];
    const host = {
      setEyeBlinkState(state: typeof LOGO_EYES_OPEN) {
        states.push(`${state.left}:${state.right}`);
      },
    };
    const animator = new WelcomeLogoEyeAnimator(host, () => {});
    animator.start();

    expect(states[0]).toBe('glance:open');
    vi.advanceTimersByTime(540);
    expect(states).toContain('closed:open');
    expect(states).toContain('open-shine:open');
    vi.advanceTimersByTime(600);
    expect(states.at(-1)).toBe('open:open');
    animator.dispose();
  });

  it('plays the installer blink sequence on startup', async () => {
    let renderCount = 0;
    let lastOutput = '';
    const welcome = new WelcomeComponent(appState, () => {
      renderCount++;
      lastOutput = welcome.render(100).join('\n');
    });

    await Promise.resolve();
    expect(renderCount).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1100);
    const joined = welcome.render(100).join('\n');
    const faceLine = joined.split('\n').find((line) => line.includes('◖'));
    expect(faceLine).toBeDefined();
    expect(faceLine).toMatch(/◉.*◉/);

    welcome.dispose();
  });
});
