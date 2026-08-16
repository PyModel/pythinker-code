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

    const darwinSidebarRules = rulesFor(darwin, ' .side)', '.sidebar-rail');
    expect(darwinSidebarRules).toHaveLength(1);
    expect(darwinSidebarRules[0]!.declarations).toContain(
      'color-mix(in srgb, var(--panel) 55%, transparent)',
    );
  });
});
