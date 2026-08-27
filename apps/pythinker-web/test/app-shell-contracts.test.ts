import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(join(import.meta.dirname, '../src/App.vue'), 'utf8');
const appStyles = readFileSync(join(import.meta.dirname, '../src/style.css'), 'utf8');
const composer = readFileSync(join(import.meta.dirname, '../src/components/chat/Composer.vue'), 'utf8');
const chatDock = readFileSync(join(import.meta.dirname, '../src/components/chat/ChatDock.vue'), 'utf8');
const conversationPane = readFileSync(join(import.meta.dirname, '../src/components/chat/ConversationPane.vue'), 'utf8');
const mobileSheet = readFileSync(join(import.meta.dirname, '../src/components/mobile/MobileSettingsSheet.vue'), 'utf8');
const sidebar = readFileSync(join(import.meta.dirname, '../src/components/Sidebar.vue'), 'utf8');
const sidebarBannerDark = readFileSync(join(import.meta.dirname, '../public/brand/pythinker_banner_dark.svg'), 'utf8');
const sessionRow = readFileSync(join(import.meta.dirname, '../src/components/SessionRow.vue'), 'utf8');
const sideChat = readFileSync(join(import.meta.dirname, '../src/components/chat/SideChatPanel.vue'), 'utf8');
const client = readFileSync(join(import.meta.dirname, '../src/composables/usePythinkerWebClient.ts'), 'utf8');

describe('app shell contracts', () => {
  it('mounts the desktop chrome', () => {
    expect(app).toContain("import WindowControls from './components/WindowControls.vue';");
    expect(app).toContain("import UpdateDialog from './components/UpdateDialog.vue';");
    expect(app).toContain('<WindowControls />');
    expect(app).toContain('<UpdateDialog />');
  });

  it('mounts the session capability menu in the composer', () => {
    expect(composer).toContain("import CapabilityMenu from '../CapabilityMenu.vue';");
    expect(composer).toContain('<CapabilityMenu ref="capMenuRef" :session-id="sessionId" triggerless />');
    expect(composer).toContain("id: 'capabilities'");
  });

  it('offers Dynamic Workflow from the same surfaces as Goal and Plan', () => {
    // The "+" add menu lists a workflow row; toggling emits up the chain and
    // App owns the state change (Composer stays dumb).
    expect(composer).toContain("id: 'workflow'");
    expect(composer).toContain('toggleWorkflow: [];');
    expect(chatDock).toContain(`@toggle-workflow="emit('toggleWorkflow')"`);
    expect(conversationPane).toContain(`@toggle-workflow="emit('toggleWorkflow')"`);
    expect(app).toContain('@toggle-workflow="client.toggleDynamicWorkflowMode()"');
    // The active-mode chip is dismissible.
    expect(composer).toContain("t('status.dynamicWorkflowDismiss')");
    // The mobile sheet carries an interactive switch.
    expect(mobileSheet).toContain(':aria-checked="dynamicWorkflowMode" @click="emit(\'toggleWorkflow\')"');
  });

  it('uses the Pythinker banner in the sidebar brand', () => {
    expect(sidebar).toContain('src="/brand/pythinker_banner_dark.svg"');
    expect(sidebar).not.toContain('pythinker_banner_light.svg');
    expect(sidebar).not.toContain('useIsDark');
    expect(sidebar).toContain('alt="Pythinker Code"');
    expect(sidebar).not.toContain("import PythinkerLogo from './PythinkerLogo.vue';");
    expect(sidebar).not.toContain('<span class="ch-name">');
    expect(sidebar).not.toMatch(/\.ch-logo\s*\{[^}]*top:/s);
    expect(sidebar).toMatch(/\.ch-logo\s*\{[^}]*width: min\(220px, 100%\);/s);
    expect(sidebarBannerDark).toContain('width="1020" height="180" viewBox="238 395 1020 180"');
  });

  it('uses one green update icon with a release-notes hover preview', () => {
    expect(sidebar).toContain('data-testid="sidebar-update-notes"');
    expect(sidebar).toContain('<ReleaseNotes');
    // The chat renderer drags katex, mermaid and shiki into the popover and
    // renders raw HTML as live DOM. Release notes get their own renderer.
    expect(sidebar).not.toContain("import('./chat/Markdown.vue')");
    expect(sidebar).toContain('<Icon name="update-button" />');
    expect(sidebar).toMatch(/\.sidebar-update-trigger\s*\{[^}]*width: 32px;[^}]*height: 32px;[^}]*border-radius: var\(--radius-full\);[^}]*background: transparent;/s);
    expect(sidebar).not.toContain('update-label-shimmer');
    expect(sidebar).not.toContain('class="update-wrap"');
  });

  it('keeps desktop traffic lights clear and places the update trigger in the brand header', () => {
    expect(sidebar).toMatch(/\.side\.macos-desktop \.ch\s*\{[^}]*padding-top: 36px;/s);
    expect(appStyles).toContain('--macos-titlebar-controls-fallback-x: 76px;');
    expect(appStyles).toContain('--macos-titlebar-controls-start: calc(env(titlebar-area-x, var(--macos-titlebar-controls-fallback-x)) + var(--space-2))');
    expect(app).toContain('left: var(--macos-titlebar-controls-start);');
    expect(app).toContain('left: calc(var(--macos-titlebar-controls-start) + var(--icon-button-sm));');
    expect(app).not.toContain('left: 72px;');
    expect(app).not.toContain('left: 98px;');
    expect(sidebar).toContain('<div class="ch-actions">');
    expect(sidebar.indexOf('data-testid="sidebar-update"')).toBeLessThan(sidebar.indexOf('class="ch-collapse"'));
    expect(sidebar.indexOf('data-testid="sidebar-update"')).toBeLessThan(sidebar.indexOf('</div>\n\n      <!-- New chat'));
    expect(sidebar).not.toMatch(/\.btn-update\s*\{/s);
  });

  it('persists and reorders pinned sessions', () => {
    expect(client).toContain('STORAGE_KEYS.pinnedSessions');
    expect(client).toContain('function togglePinnedSession(id: string)');
    expect(client).toContain('function reorderPinnedSessions(ids: string[])');
    expect(sidebar).toContain('<PinnedSessionList');
  });

  it('shows archived sessions only in the Done view and restores them', () => {
    expect(sidebar).toContain("statusView === 'done'");
    expect(sidebar).toContain(':sessions="pinnedSessions"');
    // Done sessions render grouped by workspace (doneGroups → per-group rows).
    expect(sidebar).toContain('v-for="dg in doneGroups"');
    expect(sidebar).toContain('v-for="session in dg.sessions"');
    expect(sidebar).toContain(`@restore="emit('restore', $event)"`);
    expect(app).toContain('await client.restoreSession(id)');
  });

  it('renders a leading session emoji separately from the title', () => {
    expect(sessionRow).toContain('splitTitleEmoji(props.session.title)');
    expect(sessionRow).toContain('class="session-emoji"');
    expect(sessionRow).toContain('{{ titleParts.rest }}');
  });

  it('keeps global Escape IME-safe and focuses side chat after it opens', () => {
    expect(app).toContain('e.isComposing');
    expect(app).toContain('ref="sideChatPanelRef"');
    expect(app).toContain('sideChatPanelRef.value?.focusInput()');
    expect(sideChat).toContain('defineExpose({ focusInput });');
  });

  it('fits the model menu to the visual viewport', () => {
    expect(composer).toContain("'flip-down': modelMenuFlipDown");
    expect(composer).toContain('window.visualViewport');
    expect(composer).toContain('style.maxHeight = modelMenuMaxHeight.value');
  });
});
