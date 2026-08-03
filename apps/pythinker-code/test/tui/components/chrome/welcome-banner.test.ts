import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildWelcomeCopy,
  buildWelcomeInfoItems,
  renderWelcomeBanner,
} from '#/tui/components/chrome/welcome-banner';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import type { AppState } from '#/tui/types';
import type { GitStatusCache } from '#/utils/git/git-status';

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}

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

describe('renderWelcomeBanner', () => {
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
  });

  it('renders the Python-style headline and strapline', () => {
    const lines = renderWelcomeBanner({
      width: 100,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('Welcome to Pythinker — think first, then code.');
    expect(joined).toContain('Review · Secure · Diagnose · Build with confidence.');
    expect(joined).toMatch(/Type .*\/help.* for commands\./);
    expect(joined).toContain('Pythinker Code');
    expect(joined).toContain('v1.2.3');
    const topBorder = lines
      .find((line) => line.replace(/\u001B\[[0-9;]*m/g, '').includes('╭'))
      ?.replace(/\u001B\[[0-9;]*m/g, '');
    expect(topBorder?.endsWith('╮')).toBe(true);
  });

  it('embeds version in the panel title and facts without a Version row', () => {
    const lines = renderWelcomeBanner({
      width: 100,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('v1.2.3');
    expect(joined).not.toMatch(/Version:/);
  });

  it('keeps the stacked layout on narrow terminals', () => {
    const plain = renderWelcomeBanner({
      width: 60,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    }).map(stripAnsi);

    const logoRowIndex = plain.findIndex((line) => line.includes('●') && line.includes('│'));
    const welcomeRowIndex = plain.findIndex(
      (line) => line.includes('Welcome to Pythinker') && line.includes('│'),
    );
    expect(logoRowIndex).toBeGreaterThanOrEqual(0);
    expect(welcomeRowIndex).toBeGreaterThan(logoRowIndex);
    expect(plain[welcomeRowIndex]).not.toMatch(/●.*Welcome to Pythinker/);
    expect(plain[welcomeRowIndex]).not.toContain('Tips');
    expect(plain.some((line) => line.includes('Review · Secure · Diagnose'))).toBe(true);
    expect(plain.some((line) => line.includes('/help'))).toBe(true);
  });

  it('starts the tips column beside the welcome copy on wide terminals', () => {
    const plain = renderWelcomeBanner({
      width: 120,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    }).map(stripAnsi);

    const welcomeRow = plain.find((line) => line.includes('Welcome to Pythinker'));
    expect(welcomeRow).toBeDefined();
    expect(welcomeRow).toMatch(/Welcome to Pythinker[^│]*│[^│]*Tips/);
    expect(plain.some((line) => line.includes('/help'))).toBe(true);
  });

  it('orders facts and right-aligns their labels in the wide left column', () => {
    const gitCache: GitStatusCache = {
      getStatus: () => ({
        branch: 'main',
        dirty: false,
        ahead: 0,
        behind: 0,
        diffAdded: 0,
        diffDeleted: 0,
        pullRequest: null,
      }),
    };
    const plain = renderWelcomeBanner({
      width: 120,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, gitCache),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    }).map(stripAnsi);

    const labels = ['Directory', 'Branch', 'Model', 'Session', 'Auto-save'];
    const rows = labels.map((label) => plain.findIndex((line) => line.includes(label)));
    expect(rows.every((row) => row >= 0)).toBe(true);
    for (let index = 1; index < rows.length; index++) {
      expect(rows[index]).toBeGreaterThan(rows[index - 1]!);
    }

    const directoryRow = plain[rows[0]!]!;
    const branchRow = plain[rows[1]!]!;
    expect(directoryRow.indexOf('Directory') + 'Directory'.length).toBe(
      branchRow.indexOf('Branch') + 'Branch'.length,
    );
  });

  it('aligns panel borders on every row', () => {
    for (const width of [80, 100, 120]) {
      const plain = renderWelcomeBanner({
        width,
        version: appState.version,
        infoItems: buildWelcomeInfoItems(appState, null),
        copy: buildWelcomeCopy(false),
        asciiMode: false,
      }).map(stripAnsi);

      const panelLines = plain.filter((line) => line.includes('│') || line.includes('╭') || line.includes('╰'));
      for (const line of panelLines) {
        expect(visibleWidth(line)).toBe(width);
      }
    }
  });

  it('keeps every line within the requested width', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 80, 100]) {
      for (const line of renderWelcomeBanner({
        width,
        version: appState.version,
        infoItems: buildWelcomeInfoItems(appState, null),
        copy: buildWelcomeCopy(false),
      })) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(width, 0));
      }
    }
  });

  it('uses multiple brand colors on the robot mark', () => {
    const lines = renderWelcomeBanner({
      width: 100,
      version: appState.version,
      infoItems: buildWelcomeInfoItems(appState, null),
      copy: buildWelcomeCopy(false),
      asciiMode: false,
    });
    const logoLine = lines.find((line) => line.includes('●'));
    expect(logoLine).toBeDefined();
    expect(logoLine).toMatch(/\u001B\[38;2;\d+;\d+;\d+m/);
  });
});
