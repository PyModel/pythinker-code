// apps/pythinker-web/test/session-row.test.ts
//
// The sidebar row spins ONLY while the session is busy (running with a real
// task), and surfaces the 5-state lifecycle status: awaiting shows its pending
// tag, aborted shows a distinct "stopped" tag — neither spins.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import SessionRow from '../src/components/SessionRow.vue';
import enWorkspace from '../src/i18n/locales/en/workspace';
import enSidebar from '../src/i18n/locales/en/sidebar';
import type { Session } from '../src/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { workspace: enWorkspace, sidebar: enSidebar } },
  missingWarn: false,
  fallbackWarn: false,
});

const sessionRowSource = readFileSync(
  resolve(import.meta.dirname, '../src/components/SessionRow.vue'),
  'utf8',
);
const sessionRowStyle = sessionRowSource.match(/<style scoped>([\s\S]*?)<\/style>/u)?.[1];
if (!sessionRowStyle) throw new Error('SessionRow.vue must have a scoped style block');

const sidebarSource = readFileSync(
  resolve(import.meta.dirname, '../src/components/Sidebar.vue'),
  'utf8',
);
const sidebarStyle = sidebarSource.match(/<style scoped>([\s\S]*?)<\/style>/u)?.[1];
if (!sidebarStyle) throw new Error('Sidebar.vue must have a scoped style block');

const globalStyleSource = readFileSync(
  resolve(import.meta.dirname, '../src/style.css'),
  'utf8',
);

function declarations(source: string, selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';
}

function row(session: Partial<Session>, extra: Record<string, unknown> = {}) {
  const full: Session = { id: 's1', title: 'Demo', time: '1m', status: 'idle', busy: false, ...session };
  return mount(SessionRow, {
    props: { session: full, active: false, ...extra },
    global: { plugins: [i18n] },
  });
}

describe('SessionRow status / busy', () => {
  it('spins only when busy', () => {
    expect(row({ status: 'running', busy: true }).find('.run-ico').exists()).toBe(true);
    // Awaiting input is not "working" — no spinner even though status != idle.
    expect(row({ status: 'awaitingApproval', busy: false }).find('.run-ico').exists()).toBe(false);
    expect(row({ status: 'aborted', busy: false }).find('.run-ico').exists()).toBe(false);
    expect(row({ status: 'idle', busy: false }).find('.run-ico').exists()).toBe(false);
  });

  it('shows the awaiting tag from status even without loaded pending counts', () => {
    const w = row({ status: 'awaitingApproval', busy: false });
    expect(w.find('.tag-approve').exists()).toBe(true);
    expect(w.find('.tag-aborted').exists()).toBe(false);
  });

  it('shows a distinct aborted tag', () => {
    const w = row({ status: 'aborted', busy: false });
    expect(w.find('.tag-aborted').exists()).toBe(true);
    expect(w.text()).toContain('Stopped');
  });

  it('shows no status tag for a plain idle session', () => {
    const w = row({ status: 'idle', busy: false });
    expect(w.find('.tag-approve').exists()).toBe(false);
    expect(w.find('.tag-ask').exists()).toBe(false);
    expect(w.find('.tag-aborted').exists()).toBe(false);
  });
});

describe('SessionRow design tokens', () => {
  it('uses the translucent hover token instead of a solid panel fill', () => {
    const hover = declarations(sessionRowStyle, '.se:hover');

    expect(hover).toContain('background: var(--hover)');
    expect(hover).not.toContain('var(--panel2)');
  });

  it('uses MenuRow\'s mixed wash for the selected row', () => {
    const selected = declarations(sessionRowStyle, '.se.on');

    expect(selected).toContain('background: color-mix(in srgb, var(--soft) 45%, var(--panel))');
    expect(selected).not.toContain('background: var(--soft)');
  });

  it('uses the medium radius token for the row', () => {
    expect(declarations(sessionRowStyle, '.se')).toContain('border-radius: var(--r-md)');
  });

  it('keeps the modern and pythinker row overrides aligned', () => {
    const themedRow = ':is(html[data-theme="modern"], html[data-theme="pythinker"]) .sessions .se';

    expect(declarations(globalStyleSource, themedRow)).toContain('border-radius: var(--r-md)');
    expect(declarations(globalStyleSource, `${themedRow}:hover`)).toContain('background: var(--hover)');
    expect(declarations(globalStyleSource, `${themedRow}.on`)).toContain(
      'background: color-mix(in srgb, var(--soft) 45%, var(--panel))',
    );
  });

  it('derives row height and title size from the UI font size', () => {
    const rowStyle = declarations(sessionRowStyle, '.se');
    const titleStyle = declarations(sessionRowStyle, '.t');

    expect(rowStyle).toContain('min-height: calc(var(--ui-font-size) + 13px)');
    // A MINIMUM, never a fixed height — the row also carries an 18px tag pill
    // and the archive-confirm strip, and a fixed height clips both.
    expect(rowStyle).not.toMatch(/(^|[^-])height:\s*calc/u);
    expect(rowStyle).toContain('box-sizing: border-box');
    expect(titleStyle).toContain('font-size: calc(var(--ui-font-size) - 1px)');
    expect(sessionRowStyle).toContain('Default 14px: 14 + 13 = 27px; 14 - 1 = 13px.');
  });

  it('keeps the selected row title visibly bolder', () => {
    const wrapper = row({}, { active: true });

    expect(wrapper.find('.se').classes()).toContain('on');
    expect(declarations(sessionRowStyle, '.se.on .t')).toContain('font-weight: 500');
  });

  it('keeps the SessionRow free of dark utilities and new color literals', () => {
    // The one literal that predates the token migration. Anything else is a new
    // hardcoded colour, which breaks two of the three themes. Listed explicitly
    // rather than diffed against git, so the check still bites after it lands.
    const allowed = new Set(['rgba(0,0,0,0.08)']);
    const colorLiterals = sessionRowSource.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/giu) ?? [];

    expect(sessionRowSource).not.toMatch(/\bdark:/u);
    expect(colorLiterals.filter((literal) => !allowed.has(literal))).toEqual([]);
  });
});

describe('Sidebar section heading styling', () => {
  it('uses a quiet relative size for the workspace section label', () => {
    const heading = declarations(sidebarStyle, '.ws-head-label');

    expect(heading).toContain('color: var(--muted)');
    expect(heading).toContain('font-size: calc(var(--ui-font-size) - 2px)');
  });
});
