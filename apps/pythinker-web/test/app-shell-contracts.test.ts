import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(join(import.meta.dirname, '../src/App.vue'), 'utf8');
const composer = readFileSync(join(import.meta.dirname, '../src/components/chat/Composer.vue'), 'utf8');
const chatDock = readFileSync(join(import.meta.dirname, '../src/components/chat/ChatDock.vue'), 'utf8');
const conversationPane = readFileSync(join(import.meta.dirname, '../src/components/chat/ConversationPane.vue'), 'utf8');
const mobileSheet = readFileSync(join(import.meta.dirname, '../src/components/mobile/MobileSettingsSheet.vue'), 'utf8');
const sidebar = readFileSync(join(import.meta.dirname, '../src/components/Sidebar.vue'), 'utf8');
const sessionRow = readFileSync(join(import.meta.dirname, '../src/components/SessionRow.vue'), 'utf8');
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

  it('uses the Pythinker robot in the sidebar brand', () => {
    expect(sidebar).toContain("import PythinkerLogo from './PythinkerLogo.vue';");
    expect(sidebar).toContain('<PythinkerLogo');
    expect(sidebar).not.toContain('<svg ref="logoRef"');
    expect(sidebar).not.toContain("'is-dev': isDev");
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
});
