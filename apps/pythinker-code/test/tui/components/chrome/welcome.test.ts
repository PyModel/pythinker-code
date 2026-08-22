import { visibleWidth } from '@pymodel/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildWelcomeCopy,
  buildWelcomeInfoItems,
  renderWelcomeBanner,
} from '#/tui/components/chrome/welcome-banner';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { setRainbowHatch, type RainbowHatchController } from '#/tui/easter-eggs/hatch';
import type { AppState } from '#/tui/types';

const TRUECOLOR_PATTERN = /\u001B\[38;2;(\d+);(\d+);(\d+)m/g;

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinkingEffort: 'off',
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  stepRetry: null,
  planMode: false,
  inputMode: 'prompt',
  dynamicWorkflowMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

function truecolorCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(TRUECOLOR_PATTERN)) {
    codes.add(`${match[1]},${match[2]},${match[3]}`);
  }
  return codes;
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

/** The two header rows (logo + title) of the rendered welcome box. */
function headerOf(lines: string[]): string {
  return [lines[3], lines[4]].join('\n');
}

function setHatchView(colored: boolean, phase: number): void {
  const hatch: RainbowHatchController = {
    colored,
    phase,
    start: () => {},
    stop: () => {},
    dispose: () => {},
  };
  setRainbowHatch(hatch);
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    setRainbowHatch(undefined);
  });

  it('renders the branded banner with semantic logo colors by default', () => {
    const codes = truecolorCodes(headerOf(new WelcomeComponent(appState).render(80)));

    // The static logo uses themed accent, body, and border tokens; rainbow is
    // still off until /hatch is activated.
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });

  it('paints the banner in rainbow while colored', () => {
    setHatchView(true, 0);
    const codes = truecolorCodes(headerOf(new WelcomeComponent(appState).render(80)));

    expect(codes.size).toBeGreaterThanOrEqual(5);
  });

  it('renders exactly the default banner when not colored', () => {
    const base = headerOf(new WelcomeComponent(appState).render(80));
    setHatchView(false, 5);
    const off = headerOf(new WelcomeComponent(appState).render(80));

    expect(off).toBe(base);
  });

  it('renders session facts, branch metadata, and optional tips in the panel', () => {
    const gitCache = {
      getStatus: () => ({
        branch: 'feature/tui',
        dirty: true,
        ahead: 1,
        behind: 0,
        diffAdded: 2,
        diffDeleted: 1,
        pullRequest: null,
      }),
    };
    const plain = renderWelcomeBanner({
      width: 120,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, gitCache),
      copy: buildWelcomeCopy(false),
      tips: [{ name: 'Tip', value: '/help opens commands' }],
    }).map(stripAnsi);
    const joined = plain.join('\n');

    expect(joined).toContain('Pythinker Code');
    expect(joined).toContain('feature/tui');
    expect(joined).toContain('Directory');
    expect(joined).toContain('Model');
    expect(joined).toContain('Session');
    expect(joined).toContain('Auto-save');
    expect(joined).toContain('Tips');
    expect(joined).toContain('/help opens commands');
    expect(joined).not.toContain('Version:');
  });

  it('uses an ASCII frame and copy when requested for dumb terminals', () => {
    const plain = renderWelcomeBanner({
      width: 80,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: true,
    }).map(stripAnsi);
    const joined = plain.join('\n');

    expect(joined).toContain('+');
    expect(joined).toContain('-');
    expect(joined).not.toContain('╭');
    expect(joined).not.toContain('╰');
    expect(joined).not.toContain('•');
  });

  it('keeps every line within the requested width on narrow terminals', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 80]) {
      for (const line of new WelcomeComponent(appState).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('shows model status on narrow terminals', () => {
    const info = renderWelcomeBanner({
      width: 20,
      version: appState.version,
      infoItems: [{ name: 'Model', value: 'k2', level: 'info' }],
      copy: buildWelcomeCopy(false),
    }).map(stripAnsi);
    expect(info.some((line) => line.includes('Model: k2'))).toBe(true);

    const warning = renderWelcomeBanner({
      width: 20,
      version: appState.version,
      infoItems: [
        { name: 'Model', value: 'not set, run /login or /provider', level: 'warn' },
      ],
      copy: buildWelcomeCopy(false),
    }).map(stripAnsi);
    expect(warning.some((line) => line.includes('Model: not set'))).toBe(true);
  });
});
