import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  setRainbowColors,
  type RainbowColorController,
} from '#/tui/easter-eggs/rainbow-colors';
import type { AppState } from '#/tui/types';

const TRUECOLOR_PATTERN = /\u001B\[38;2;(\d+);(\d+);(\d+)m/g;

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

function truecolorCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(TRUECOLOR_PATTERN)) {
    codes.add(`${match[1]},${match[2]},${match[3]}`);
  }
  return codes;
}

/** Header rows that contain the logo or welcome title. */
function headerOf(lines: string[]): string {
  return lines
    .filter(
      (line) => line.includes('●') || line.includes('Welcome to Pythinker — think first, then code.'),
    )
    .join('\n');
}

function setColorsView(colored: boolean, phase: number): void {
  const colors: RainbowColorController = {
    colored,
    phase,
    start: () => {},
    stop: () => {},
    dispose: () => {},
  };
  setRainbowColors(colors);
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;
  const previousTerm = process.env['TERM'];

  beforeEach(() => {
    chalk.level = 3;
    process.env['TERM'] = 'xterm-256color';
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    if (previousTerm === undefined) delete process.env['TERM'];
    else process.env['TERM'] = previousTerm;
    setRainbowColors(undefined);
  });

  it('renders the banner with brand palette colors by default', () => {
    const codes = truecolorCodes(headerOf(new WelcomeComponent(appState).render(80)));

    // Multi-color SVG palette on the logo, but no rainbow flow.
    expect(codes.size).toBeGreaterThanOrEqual(3);
    expect(codes.size).toBeLessThan(8);
  });

  it('paints the banner in rainbow while colors are active', () => {
    setColorsView(true, 0);
    const codes = truecolorCodes(new WelcomeComponent(appState).render(80).join('\n'));

    expect(codes.size).toBeGreaterThanOrEqual(5);
  });

  it('renders exactly the default banner when colors are inactive', () => {
    const base = headerOf(new WelcomeComponent(appState).render(80));
    setColorsView(false, 5);
    const off = headerOf(new WelcomeComponent(appState).render(80));

    expect(off).toBe(base);
  });

  it('keeps every line within the requested width on narrow terminals', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 80]) {
      for (const line of new WelcomeComponent(appState).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
