import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(join(import.meta.dirname, '../src/App.vue'), 'utf8');
const composer = readFileSync(join(import.meta.dirname, '../src/components/chat/Composer.vue'), 'utf8');
const sidebar = readFileSync(join(import.meta.dirname, '../src/components/Sidebar.vue'), 'utf8');

describe('app shell contracts', () => {
  it('mounts the desktop chrome', () => {
    expect(app).toContain("import WindowControls from './components/WindowControls.vue';");
    expect(app).toContain("import UpdateToast from './components/UpdateToast.vue';");
    expect(app).toContain('<WindowControls />');
    expect(app).toContain('<UpdateToast />');
  });

  it('mounts the session capability menu in the composer', () => {
    expect(composer).toContain("import CapabilityMenu from '../CapabilityMenu.vue';");
    expect(composer).toContain('<CapabilityMenu ref="capMenuRef" :session-id="sessionId" triggerless />');
  });

  it('uses the Pythinker robot in the sidebar brand', () => {
    expect(sidebar).toContain("import PythinkerLogo from './PythinkerLogo.vue';");
    expect(sidebar).toContain('<PythinkerLogo');
    expect(sidebar).not.toContain('<svg ref="logoRef"');
    expect(sidebar).not.toContain("'is-dev': isDev");
  });
});
