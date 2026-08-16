// Static contract check: CI and local development do not have a Windows host,
// so this checks the CSS contract rather than rendered geometry.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appPath = ['src/App.vue', 'apps/pythinker-web/src/App.vue'].find(existsSync);
if (!appPath) throw new Error('App.vue source was not found');

const appSource = readFileSync(appPath, 'utf8');
const styleMatch = appSource.match(/<style scoped>([\s\S]*?)<\/style>/u);

if (!styleMatch?.[1]) throw new Error('App.vue must have a scoped style block');

const cssRules = [...styleMatch[1].matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, declarations]) => ({
  selector: selector!,
  declarations: declarations!,
}));
const win32 = "data-desktop-platform='win32'";
const darwin = "data-desktop-platform='darwin'";

function rulesFor(platform: string, ...selectors: string[]) {
  return cssRules.filter((rule) => (
    rule.selector.includes(platform) && selectors.every((selector) => rule.selector.includes(selector))
  ));
}

function rulesWithSelectors(platform: string, ...selectors: string[]) {
  return cssRules.filter((rule) => selectors.every((selector) => (
    rule.selector.split(',').some((part) => part.trim().endsWith(`:global(html[${platform}] ${selector})`))
  )));
}

describe('Windows titlebar CSS contract', () => {
  it('keeps the titlebar safe area and sidebar platform-specific', () => {
    expect(appSource).toContain('class="windows-titlebar"');
    expect(appSource).toContain('aria-hidden="true"');

    const win32DragRules = cssRules
      .filter((rule) => rule.selector.includes(win32))
      .filter((rule) => rule.declarations.includes('-webkit-app-region: drag'));
    expect(win32DragRules).toHaveLength(1);
    expect(win32DragRules[0]!.selector).toContain('.windows-titlebar');

    const win32TitlebarRules = rulesFor(win32, '.windows-titlebar');
    expect(win32TitlebarRules).toHaveLength(1);
    expect(win32TitlebarRules[0]!.declarations).toContain('titlebar-area-x');
    expect(win32TitlebarRules[0]!.declarations).toContain('titlebar-area-width');

    const win32ShellRules = rulesFor(win32, '.app-shell');
    expect(win32ShellRules).toHaveLength(1);
    expect(win32ShellRules[0]!.declarations).toContain('titlebar-area-height');

    const win32SidebarRules = rulesFor(win32, ' .side)', '.sidebar-rail');
    expect(win32SidebarRules).toHaveLength(1);
    expect(win32SidebarRules[0]!.declarations).not.toMatch(/transparent|color-mix/u);

    const darwinSidebarRules = rulesFor(darwin, ' .side)', '.sidebar-rail')
      .filter((rule) => rule.declarations.includes('background'));
    expect(darwinSidebarRules).toHaveLength(1);
    expect(darwinSidebarRules[0]!.declarations).toContain('background: transparent');
  });

  it('keeps only the expanded macOS sidebar transparent', () => {
    const collapsedRailRules = rulesFor(darwin, '.app.sidebar-collapsed .sidebar-rail');
    expect(collapsedRailRules).toHaveLength(1);
    expect(collapsedRailRules[0]!.declarations).toContain('background: var(--bg)');

    const expandedRailRules = rulesWithSelectors(darwin, '.sidebar-rail')
      .filter((rule) => rule.declarations.includes('background'));
    expect(expandedRailRules).toHaveLength(1);
    expect(expandedRailRules[0]!.declarations).toContain('background: transparent');
  });

  it('lets macOS own conversation corners without changing Windows', () => {
    const darwinConversationRules = rulesWithSelectors(darwin, '.con');
    expect(darwinConversationRules).toHaveLength(1);
    const darwinConversationRuleBody = darwinConversationRules[0]!.declarations;
    expect(darwinConversationRuleBody.trim()).not.toBe('');
    expect(darwinConversationRuleBody).not.toContain('border-top-left-radius');
    expect(darwinConversationRuleBody).not.toContain('border-bottom-left-radius');

    const darwinSidebarRules = rulesWithSelectors(darwin, '.side', '.sidebar-rail')
      .filter((rule) => rule.declarations.includes('background: transparent'));
    expect(darwinSidebarRules).toHaveLength(1);
    const darwinSidebarRuleBody = darwinSidebarRules[0]!.declarations;
    expect(darwinSidebarRuleBody.trim()).not.toBe('');
    expect(darwinSidebarRuleBody).not.toContain('border-right-color');

    const win32RuleBody = cssRules
      .filter((rule) => rule.selector.includes(win32))
      .map((rule) => rule.declarations)
      .join('\n');
    expect(win32RuleBody.trim()).not.toBe('');
    expect(win32RuleBody).not.toContain('border-top-left-radius');
  });

  it('does not add collapsed macOS conversation corner overrides', () => {
    const collapsedDarwinConversationRules = rulesWithSelectors(darwin, '.app.sidebar-collapsed .con');
    expect(collapsedDarwinConversationRules).toHaveLength(0);
  });

  it('uses separate macOS column reserves and a 32px drag strip', () => {
    const darwinRailReserveRules = rulesWithSelectors(darwin, '.sidebar-rail')
      .filter((rule) => rule.declarations.includes('padding-top'));
    expect(darwinRailReserveRules).toHaveLength(1);
    const darwinRailReserveRuleBody = darwinRailReserveRules[0]!.declarations;
    expect(darwinRailReserveRuleBody.trim()).not.toBe('');
    expect(darwinRailReserveRuleBody).toContain('padding-top: 48px');

    const darwinSideReserveRules = rulesWithSelectors(darwin, '.side')
      .filter((rule) => rule.declarations.includes('padding-top'));
    expect(darwinSideReserveRules).toHaveLength(1);
    const darwinSideReserveRuleBody = darwinSideReserveRules[0]!.declarations;
    expect(darwinSideReserveRuleBody.trim()).not.toBe('');
    expect(darwinSideReserveRuleBody).toContain('padding-top: 20px');

    const darwinDragRules = rulesWithSelectors(darwin, '.side::before', '.sidebar-rail::before');
    expect(darwinDragRules).toHaveLength(1);
    expect(darwinDragRules[0]!.declarations).toContain('left: 80px');
    expect(darwinDragRules[0]!.declarations).toContain('height: 32px');

    const bareDarwinRailRules = rulesWithSelectors(darwin, '.sidebar-rail');
    expect(bareDarwinRailRules).toHaveLength(2);
    for (const rule of bareDarwinRailRules) {
      expect(rule.declarations).not.toContain('-webkit-app-region: drag');
    }

    const darwinConversationRules = rulesWithSelectors(darwin, '.con');
    expect(darwinConversationRules).toHaveLength(1);
    expect(darwinConversationRules[0]!.declarations).toContain('padding-top: 20px');
  });
});
