import { describe, it, expect } from 'vitest';
import chalk from 'chalk';

import { FooterComponent, formatFooterGitBadge } from '#/tui/components/chrome/footer';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { darkColors } from '#/tui/theme/colors';
import type { AppState } from '#/tui/types';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function hexToSgr(hex: string): string {
  const value = hex.replace(/^#/, '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `\u001B[38;2;${String(r)};${String(g)};${String(b)}m`;
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp',
    sessionId: 'sess_1',
    permissionMode: 'manual',
    planMode: false,
    thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
    availableModels: {},
    ...overrides,
  } as AppState;
}

describe('FooterComponent — quiet context status', () => {
  it('NaN usage → renders 0% (never literal "NaN%")', () => {
    const fc = new FooterComponent(baseState({ contextUsage: Number.NaN }));
    const rows = fc.render(120);
    const out = strip(rows.join(''));
    expect(rows).toHaveLength(1);
    expect(out).not.toMatch(/NaN/);
    expect(out).toContain('▱▱▱▱▱▱▱▱ 0%');
  });

  it('undefined-ish (coerced) usage → renders 0%', () => {
    const fc = new FooterComponent(
      baseState({ contextUsage: undefined as unknown as number }),
    );
    const out = strip(fc.render(120).join(''));
    expect(out).not.toMatch(/NaN/);
    expect(out).toContain('▱▱▱▱▱▱▱▱ 0%');
  });

  it('clamps ratios above 1.0 → renders 100%', () => {
    const fc = new FooterComponent(baseState({ contextUsage: 1.5 }));
    const out = strip(fc.render(120).join(''));
    expect(out).toContain('▰▰▰▰▰▰▰▰ 100%');
  });

  it('ratio 0.427 → renders 43%', () => {
    const fc = new FooterComponent(baseState({ contextUsage: 0.427 }));
    const out = strip(fc.render(200).join(''));
    expect(out).toContain('▰▰▰▱▱▱▱▱ 43%');
  });

  it('tokens provided but max=0 → falls back to contextUsage without division-by-zero artefacts', () => {
    const fc = new FooterComponent(
      baseState({ contextUsage: 0, contextTokens: 500, maxContextTokens: 0 }),
    );
    const out = strip(fc.render(200).join(''));
    expect(out).not.toMatch(/Infinity|NaN/);
    expect(out).toMatch(/[▰▱]{8} \d+%/u);
    // With maxTokens=0, token-count annotation is suppressed.
    expect(out).not.toMatch(/500\//);
  });

  it('setState updates visible model and context values', () => {
    const footer = new FooterComponent(baseState({ model: 'k2', contextUsage: 0 }));

    footer.setState(baseState({ model: 'pythinker-k2-5', contextUsage: 0.5 }));

    const rows = footer.render(200);
    const out = strip(rows.join(''));
    expect(rows).toHaveLength(1);
    expect(out).toMatch(/^ {2}pythinker-k2-5/);
    expect(out).not.toContain(' k2 ');
    expect(out).toContain('▰▰▰▰▱▱▱▱ 50%');
    expect(out).not.toContain('/tmp');
    expect(out).not.toContain('shift+tab: plan mode');
  });

  it('shows a dim effort suffix when thinking is enabled, hides it when off', () => {
    const on = new FooterComponent(baseState({ model: 'k2', thinkingLevel: 'medium' }));
    const off = new FooterComponent(baseState({ model: 'k2', thinkingLevel: 'off' }));

    expect(strip(on.render(120)[0]!)).toContain('k2 · med');
    expect(strip(on.render(120)[0]!)).not.toMatch(/[◆*]/u);
    expect(strip(off.render(120)[0]!)).not.toContain(' · med');
  });

  it('renders transient hints on the context line', () => {
    const footer = new FooterComponent(baseState());

    footer.setTransientHint('Press Ctrl-C again to exit');

    const output = strip(footer.render(120).join('\n'));
    expect(output).toContain('Press Ctrl-C again to exit');
    expect(output).toContain('▱▱▱▱▱▱▱▱ 0%');
    expect(output).not.toContain('shift+tab: plan mode');
  });

  it('highlights the pull request badge separately from git status text', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    try {
      const out = formatFooterGitBadge(
        {
          branch: 'feature/footer',
          dirty: false,
          ahead: 0,
          behind: 0,
          diffAdded: 0,
          diffDeleted: 0,
          pullRequest: {
            number: 6,
            url: 'https://github.com/acme/repo/pull/6',
          },
        },
        darkColors,
      );

      const primaryIndex = out.indexOf(hexToSgr(darkColors.primary));
      const statusIndex = out.indexOf(hexToSgr(darkColors.textDim));
      const badgeIndex = out.indexOf('[PR#6]');
      expect(statusIndex).toBeGreaterThanOrEqual(0);
      expect(primaryIndex).toBeGreaterThanOrEqual(0);
      expect(primaryIndex).toBeLessThan(badgeIndex);
      expect(strip(out)).toContain('feature/footer ');
      expect(strip(out)).toContain('[PR#6]');
    } finally {
      chalk.level = previousLevel;
    }
  });
});
