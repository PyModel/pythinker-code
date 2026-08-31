import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(join(import.meta.dirname, '../src/App.vue'), 'utf8');
const appStyles = readFileSync(join(import.meta.dirname, '../src/style.css'), 'utf8');
const icons = readFileSync(join(import.meta.dirname, '../src/lib/icons.ts'), 'utf8');
const composer = readFileSync(join(import.meta.dirname, '../src/components/chat/Composer.vue'), 'utf8');
const chatDock = readFileSync(join(import.meta.dirname, '../src/components/chat/ChatDock.vue'), 'utf8');
const conversationPane = readFileSync(join(import.meta.dirname, '../src/components/chat/ConversationPane.vue'), 'utf8');
const mobileSheet = readFileSync(join(import.meta.dirname, '../src/components/mobile/MobileSettingsSheet.vue'), 'utf8');
const sidebar = readFileSync(join(import.meta.dirname, '../src/components/Sidebar.vue'), 'utf8');
const workspaceGroup = readFileSync(join(import.meta.dirname, '../src/components/WorkspaceGroup.vue'), 'utf8');
const expertOpinionIcon = readFileSync(
  join(import.meta.dirname, '../src/icons/pythinker/expert_opinion.svg'),
  'utf8',
);
const sidebarBannerDark = readFileSync(join(import.meta.dirname, '../public/brand/pythinker_banner_dark.svg'), 'utf8');
const sessionRow = readFileSync(join(import.meta.dirname, '../src/components/SessionRow.vue'), 'utf8');
const sideChat = readFileSync(join(import.meta.dirname, '../src/components/chat/SideChatPanel.vue'), 'utf8');
const client = readFileSync(join(import.meta.dirname, '../src/composables/usePythinkerWebClient.ts'), 'utf8');

describe('app shell contracts', () => {
  it('mounts the desktop chrome and owns the update feed', () => {
    expect(app).toContain("import WindowControls from './components/WindowControls.vue';");
    expect(app).toContain("import { useDesktopUpdate } from './composables/useDesktopUpdate';");
    expect(app).toContain('<WindowControls />');
    expect(app).toContain('const desktopUpdate = useDesktopUpdate();');
    expect(app).toContain('desktopUpdate.subscribe();');
    expect(app).toContain('desktopUpdate.unsubscribe();');
    expect(app).not.toContain('UpdateDialog');
  });

  it('mounts the session capability menu in the composer', () => {
    expect(composer).toContain("import CapabilityMenu from '../CapabilityMenu.vue';");
    expect(composer).toContain('<CapabilityMenu ref="capMenuRef" :session-id="sessionId" triggerless />');
    expect(composer).toContain("id: 'capabilities'");
  });

  it('offers Expert Opinion from the composer and right-side launchers', () => {
    expect(composer).toContain("id: 'expertOpinion'");
    expect(composer).toContain('action: openExpertOpinion');
    expect(composer).toContain('@build="loadForEdit"');
    expect(app).toContain("import ExpertTalkControl from './components/chat/ExpertTalkControl.vue';");
    expect(app).toContain('trigger="launcher"');
    expect(app).toContain('@build="handleExpertTalkBuild"');
    expect(app).toContain('loadComposerForEdit(prompt)');
    expect(app).toContain('.panel-launcher :deep(.expert-talk__launcher) { grid-column: 1 / -1; }');
  });

  it('offers Expert Opinion as a dedicated new-session mode', () => {
    expect(sidebar).toContain('createExpertOpinion: [];');
    expect(sidebar).toContain("emit('createExpertOpinion')");
    expect(sidebar).toContain('class="btn-wrap expert-opinion-wrap"');
    expect(sidebar).toContain('<Icon name="expert-opinion" />');
    expect(sidebar).not.toMatch(/\.btn-expert-opinion\s*\{[^}]*color:/s);
    expect(icons).toContain("| 'expert-opinion'");
    expect(icons).toContain("'expert-opinion': animatedEntry(RawPythinkerExpertOpinion)");
    expect(expertOpinionIcon).toContain('class="ptx ptx-expert-opinion"');
    expect(expertOpinionIcon).toContain('class="sparkle"');
    expect(app).toContain('@create-expert-opinion="handleCreateExpertOpinionSession"');
  });

  it('opens Explorer from workspace hover actions', () => {
    expect(sidebar).toContain("import WorkspaceExplorer from './WorkspaceExplorer.vue';");
    expect(sidebar).toContain('<WorkspaceExplorer');
    expect(sidebar).toContain('@toggle-explorer="toggleExplorer"');
    expect(workspaceGroup).toContain('class="gh-explorer"');
    expect(workspaceGroup).toContain('<Tooltip :text="t(\'sidebar.showFiles\')">');
    expect(workspaceGroup).toMatch(/\.gh-actions::after\s*\{[\s\S]*?pointer-events: none;/);
    expect(workspaceGroup).toContain("toggleExplorer: [workspaceId: string];");
    expect(workspaceGroup).toMatch(/class="gh-explorer"[\s\S]*?:label="t\('sidebar\.showFiles'\)"[\s\S]*?<Icon name="list" \/>[\s\S]*?class="gh-add"/);
    expect(sidebar).toContain('v-if="!explorerOpen" class="btn-wrap"');
    expect(sidebar).toContain('v-if="!explorerOpen" class="search-wrap"');
    expect(sidebar).toContain('class="side-footer" v-if="!explorerOpen"');
    expect(sidebar).toContain("if (sessionId && sessionId !== props.activeId) emit('select', sessionId);");
    expect(sidebar).toContain("return group.sessions.some((session) => session.id === props.activeId) ? props.activeId : null;");
    expect(sidebar).toContain('if (explorerOpen.value) return;');
    expect(sidebar).toContain('v-if="showSearch && !explorerOpen"');
    expect(sidebar).toContain('@close="closeExplorer"');
    expect(workspaceGroup).toContain(':data-workspace-files-id="group.workspace.id"');
    expect(sidebar).toContain("@open-file=\"emit('openFile', $event)\"");
    expect(app).toContain('@open-file="openFilePreview($event)"');
  });

  it('routes the shared Stop action to the active Expert Opinion run', () => {
    expect(client).toContain('async function abortCurrentPrompt(): Promise<void>');
    expect(client).toContain('expertTalk.status.value?.activeRunId !== undefined');
    expect(client).toContain('await expertTalk.cancel();');
    expect(client).toContain('await workspaceState.abortCurrentPrompt();');
    expect(client).toContain('abortCurrentPrompt,');
    expect(client).not.toContain('abortCurrentPrompt: workspaceState.abortCurrentPrompt');
  });

  it('uses a neutral gray sidebar in light mode', () => {
    expect(appStyles).toContain('--color-sidebar-bg: #f3f3f1;');
    expect(appStyles).toContain('--color-sidebar-glass: rgba(243, 243, 241, .92);');
    expect(appStyles).toContain('--color-sidebar-wash: none;');
    expect(appStyles).toContain('--color-sidebar-bg: #2c343a;');
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

  it('opens Explorer beside each workspace New Chat action', () => {
    expect(sidebar).toContain("import WorkspaceExplorer from './WorkspaceExplorer.vue';");
    expect(sidebar).not.toContain('class="btn-new-chat btn-explorer"');
    expect(sidebar).toContain('<WorkspaceExplorer');
    expect(sidebar).toContain('@toggle-explorer="toggleExplorer"');
    expect(workspaceGroup).toContain('class="gh-explorer"');
    expect(workspaceGroup).toContain("toggleExplorer: [workspaceId: string];");
    expect(workspaceGroup).toMatch(/class="gh-explorer"[\s\S]*?<Icon name="list" \/>[\s\S]*?class="gh-add"/);
    expect(sidebar).toContain("@open-file=\"emit('openFile', $event)\"");
    expect(app).toContain('@open-file="openFilePreview($event)"');
  });

  it('uses one green update icon with a release-notes hover preview', () => {
    expect(sidebar).toContain('data-testid="sidebar-update-notes"');
    expect(sidebar).toContain('<ReleaseNotes');
    // The chat renderer drags katex, mermaid and shiki into the popover and
    // renders raw HTML as live DOM. Release notes get their own renderer.
    expect(sidebar).not.toContain("import('./chat/Markdown.vue')");
    expect(sidebar).toContain("import Pill from './ui/Pill.vue';");
    expect(sidebar).toMatch(/<Pill[\s\S]*?class="sidebar-update-trigger"/);
    expect(sidebar).toContain('<Icon name="update-button" />');
    expect(sidebar).toMatch(/\.sidebar-update-trigger\s*\{[^}]*width: var\(--sidebar-update-size\);[^}]*height: var\(--sidebar-update-size\);[^}]*border-radius: var\(--radius-full\);/s);
    // Hover swaps the icon for the "Update" word; download progress paints
    // into the same pill instead of opening the overlay dialog.
    expect(sidebar).toContain('data-testid="sidebar-update-text"');
    expect(sidebar).toContain('@click.stop="onUpdateTriggerClick"');
    expect(sidebar).toMatch(/\.ch-actions \.sidebar-update-trigger\.is-error\s*\{[^}]*background: var\(--color-danger\);/s);
    expect(sidebar).not.toContain('update.openDialog()');
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

  it('selects a tool diff before deriving its tab title', () => {
    const openToolDiff = app.slice(
      app.indexOf('function openToolDiff(id: string): void {'),
      app.indexOf('function openDiffDetail(): void {'),
    );
    expect(openToolDiff.indexOf('showToolDiff(id);'))
      .toBeLessThan(openToolDiff.indexOf('const current = toolDiffTarget.value;'));
  });

  it('fits the model menu to the visual viewport', () => {
    expect(composer).toContain("'flip-down': modelMenuFlipDown");
    expect(composer).toContain('window.visualViewport');
    expect(composer).toContain('style.maxHeight = modelMenuMaxHeight.value');
  });
});
