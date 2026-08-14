import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import chalk from 'chalk';

import {
  deleteAllKittyImages,
  resetCapabilitiesCache,
  setCapabilities,
  type AutocompleteProvider,
  type Component,
} from '@earendil-works/pi-tui';
import type { ApprovalRequest, ApprovalResponse, Event } from '@pymodel/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalPanelComponent } from '#/tui/components/dialogs/approval-panel';
import { ApiKeyInputDialogComponent } from '#/tui/components/dialogs/api-key-input-dialog';
import {
  ANTHROPIC_PLUGIN_MARKETPLACE_URL,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL,
} from '#/constant/app';
import { appendInputHistory } from '#/utils/history/input-history';
import { performHeapDump } from '#/utils/heap-dump';
import { getInputHistoryFile } from '#/utils/paths';
import { DynamicWorkflowMissionControlComponent } from '#/tui/components/messages/dynamic-workflow-mission-control';
import { ThinkingComponent } from '#/tui/components/messages/thinking';
import { BtwPanelComponent } from '#/tui/components/panes/btw-panel';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { ChoicePickerComponent } from '#/tui/components/dialogs/choice-picker';
import { StartPermissionPromptComponent } from '#/tui/components/dialogs/start-permission-prompt';
import { ModelSelectorComponent } from '#/tui/components/dialogs/model-selector';
import { EffortSelectorComponent } from '#/tui/components/dialogs/effort-selector';
import { TabbedModelSelectorComponent } from '#/tui/components/dialogs/tabbed-model-selector';
import { UndoSelectorComponent } from '#/tui/components/dialogs/undo-selector';
import {
  PluginMcpSelectorComponent,
  PluginMarketplaceSelectorComponent,
  PluginRemoveConfirmComponent,
  PluginsOverviewSelectorComponent,
} from '#/tui/components/dialogs/plugins-selector';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { PythinkerTUI, type PythinkerTUIStartupInput, type TUIState } from '#/tui/pythinker-tui';
import type { StreamingUIController } from '#/tui/controllers/streaming-ui';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { ScrollbackBridge } from '#/tui/runtime/scrollback/scrollback-bridge';
import { handleFeedbackCommand } from '#/tui/commands/info';
import {
  promptFeedbackInput,
  runModelSelector,
} from '#/tui/commands/prompts';
import { currentTheme } from '#/tui/theme';
import type { QueuedMessage } from '#/tui/types';
import type { ImageAttachmentStore } from '#/tui/utils/image-attachment-store';
import { LEGACY_TEST_PATHS, PARITY_CASES } from './parity/feature-matrix';

vi.mock('#/tui/commands/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/tui/commands/prompts')>();
  return { ...actual, promptFeedbackInput: vi.fn() };
});

vi.mock('#/utils/open-url', () => ({ openUrl: vi.fn() }));
vi.mock('#/utils/heap-dump', () => ({ performHeapDump: vi.fn() }));

const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

function stripSgr(text: string): string {
  return text
    .replaceAll(/\u001B\[[0-9;]*m/g, '')
    .replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, 'g'), '');
}

interface MessageDriver {
  state: TUIState;
  streamingUI: StreamingUIController;
  sessionEventHandler: {
    startSubscription(): void;
    handleEvent(event: Event, sendQueued: (item: QueuedMessage) => void): void;
    clearDynamicWorkflowMissionControls(): void;
    hasDynamicWorkflowMissionControl(toolCallId: string): boolean;
    resetRuntimeState(): void;
  };
  init(): Promise<boolean>;
  handleUserInput(text: string): void;
  sendSkillActivation(
    session: ReturnType<typeof makeSession>,
    skillName: string,
    skillArgs: string,
  ): void;
  persistInputHistory(text: string): Promise<void>;
  getCurrentSessionId(): string;
}

interface FeedbackDriver extends MessageDriver {
  handleFeedbackCommand(): Promise<void>;
  promptFeedbackInput(): Promise<string | undefined>;
}

interface ModelSelectorDriver extends MessageDriver {
  runModelSelector(
    models: Record<
      string,
      {
        provider: string;
        model: string;
        maxContextSize: number;
        displayName?: string;
        capabilities?: string[];
      }
    >,
  ): Promise<{ alias: string; effort: string } | undefined>;
}

function makeStartupInput(layout: 'inline' | 'fixed' = 'inline'): PythinkerTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      rewindFiles: undefined,
      yolo: false,
      auto: false,
      plan: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
    },
    tuiConfig: {
      theme: 'dark',
      layout,
      copyFullResponse: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
    },
    version: '0.0.0-test',
    workDir: '/tmp/proj-a',
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  const prompt = vi.fn(async (_input: unknown) => {});
  return {
    id: 'ses-1',
    model: 'k2',
    summary: { title: null },
    prompt,
    steer: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    startBtw: vi.fn(async () => 'agent-btw'),
    undoHistory: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    listFileCheckpoints: vi.fn(async () =>
      prompt.mock.calls.map(([input], index) => ({
        id: `checkpoint-${String(index + 1)}`,
        kind: 'user' as const,
        createdAt: new Date(Date.UTC(2026, 6, 30, 12, index)).toISOString(),
        prompt:
          typeof input === 'string'
            ? input
            : Array.isArray(input)
              ? input
                  .filter(
                    (part: unknown): part is { type: 'text'; text: string } =>
                      typeof part === 'object' &&
                      part !== null &&
                      'type' in part &&
                      part.type === 'text' &&
                      'text' in part &&
                      typeof part.text === 'string',
                  )
                  .map((part: { type: 'text'; text: string }) => part.text)
                  .join('')
              : 'User prompt',
        complete: true,
        changedPaths: [],
      })),
    ),
    previewFileCheckpoint: vi.fn(async (checkpointId: string) => ({
      checkpointId,
      complete: true,
      paths: [],
      insertions: 0,
      deletions: 0,
      conversationAvailable: true,
    })),
    restoreFileCheckpoint: vi.fn(async (checkpointId: string) => ({
      checkpointId,
      recoveryCheckpointId: 'recovery-1',
      restoredPaths: [],
      deletedPaths: [],
    })),
    cancel: vi.fn(async () => {}),
    cancelCompaction: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({
      model: 'k2',
      thinkingLevel: 'off',
      permission: 'manual',
      planMode: false,
      contextTokens: 0,
      maxContextTokens: 100,
      contextUsage: 0,
    })),
    getGoal: vi.fn(async () => ({ goal: null })),
    listBackgroundTasks: vi.fn(async () => []),
    setApprovalHandler: vi.fn(),
    setQuestionHandler: vi.fn(),
    setModel: vi.fn(async () => {}),
    setThinking: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    setPlanMode: vi.fn(async () => {}),
    setDynamicWorkflowMode: vi.fn(async () => {}),
    onEvent: vi.fn(() => vi.fn()),
    listMcpServers: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    activateSkill: vi.fn(async () => ({ execution: 'inline' as const })),
    getResumeState: vi.fn(() => ({
      sessionMetadata: {},
      agents: {
        main: {
          status: {
            model: 'k2',
            thinkingLevel: 'off',
            permission: 'manual',
            planMode: false,
            contextTokens: 0,
            maxContextTokens: 100,
            contextUsage: 0,
          },
          context: { history: [] },
          replay: [],
        },
      },
    })),
    close: vi.fn(async () => {}),
    listPlugins: vi.fn(async () => []),
    installPlugin: vi.fn(async () => ({
      id: 'demo',
      displayName: 'Demo',
      version: '1.0.0',
      enabled: true,
      state: 'ok',
      skillCount: 1,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
    })),
    setPluginEnabled: vi.fn(async () => {}),
    setPluginMcpServerEnabled: vi.fn(async () => {}),
    removePlugin: vi.fn(async () => {}),
    reloadPlugins: vi.fn(async () => ({ added: [], removed: [], errors: [] })),
    reloadSession: vi.fn(async () => ({})),
    getPluginInfo: vi.fn(async (id: string) => ({
      id,
      displayName: id,
      version: '1.0.0',
      enabled: true,
      state: 'ok',
      skillCount: 1,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
      source: 'local-path',
      root: `/plugins/${id}`,
      manifest: undefined,
      mcpServers: [],
      diagnostics: [],
    })),
    ...overrides,
  };
}

function makeHarness(session = makeSession(), overrides: Record<string, unknown> = {}) {
  const interactiveAgentScope = new AsyncLocalStorage<string>();
  return {
    getConfig: vi.fn(async () => ({
      models: {
        k2: { model: 'pythoughts-v1', maxContextSize: 100 },
      },
    })),
    setConfig: vi.fn(async () => ({ providers: {} })),
    createSession: vi.fn(async () => session),
    resumeSession: vi.fn(async () => session),
    forkSession: vi.fn(async () => session),
    listSessions: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    track: vi.fn(),
    setTelemetryContext: vi.fn(),
    get interactiveAgentId() {
      return interactiveAgentScope.getStore() ?? 'main';
    },
    withInteractiveAgent: vi.fn((agentId: string, fn: () => unknown) => {
      return interactiveAgentScope.run(agentId, fn);
    }),
    getExperimentalFeatures: vi.fn(async () => []),
    auth: {
      status: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getManagedUsage: vi.fn(),
      submitFeedback: vi.fn(
        async (): Promise<{ kind: 'ok' } | { kind: 'error'; status?: number; message: string }> => ({
          kind: 'ok',
        }),
      ),
    },
    ...overrides,
  };
}

async function makeDriver(
  session = makeSession(),
  harnessOverrides: Record<string, unknown> = {},
  layout: 'inline' | 'fixed' = 'inline',
): Promise<{
  driver: MessageDriver;
  session: ReturnType<typeof makeSession>;
  harness: ReturnType<typeof makeHarness>;
}> {
  const harness = makeHarness(session, harnessOverrides);
  const driver = new PythinkerTUI(harness as never, makeStartupInput(layout)) as unknown as MessageDriver;
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  vi.spyOn(driver.state.terminal, 'setProgress').mockImplementation(() => {});
  driver.persistInputHistory = vi.fn(async () => {});
  await driver.init();
  return { driver, session, harness };
}

function renderTranscript(driver: MessageDriver): string {
  return driver.state.transcriptContainer.render(120).join('\n');
}

function renderMcpStatus(driver: Readonly<MessageDriver>): string {
  return driver.state.mcpStatusContainer.render(120).join('\n');
}

async function confirmUndoSelection(driver: MessageDriver): Promise<void> {
  await vi.waitFor(() => {
    expect(driver.state.editorContainer.children[0]).toBeInstanceOf(UndoSelectorComponent);
  });
  (driver.state.editorContainer.children[0] as UndoSelectorComponent).handleInput('\r');
}

function renderActivity(driver: MessageDriver): string {
  return driver.state.activityContainer.render(120).join('\n');
}

function renderBtwPanel(driver: MessageDriver): string {
  return driver.state.btwPanelContainer.render(120).join('\n');
}

function getMountedBtwPanel(driver: MessageDriver): BtwPanelComponent {
  const panel = driver.state.btwPanelContainer.children.find(
    (child) => child instanceof BtwPanelComponent,
  );
  if (panel === undefined) throw new Error('Expected a mounted /btw panel.');
  return panel;
}

async function openBtwPanel(
  driver: MessageDriver,
  session: ReturnType<typeof makeSession>,
  prompt = 'side question',
): Promise<void> {
  driver.handleUserInput(`/btw ${prompt}`);
  await vi.waitFor(() => {
    expect(session.startBtw).toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(2);
  });
}

function setTerminalRows(driver: MessageDriver, rows: number): void {
  Object.defineProperty(driver.state.terminal, 'rows', {
    configurable: true,
    get: () => rows,
  });
}

function setTerminalColumns(driver: MessageDriver, columns: number): void {
  Object.defineProperty(driver.state.terminal, 'columns', {
    configurable: true,
    get: () => columns,
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function dispatchTerminalInput(driver: MessageDriver, data: string): void {
  (driver.state.ui as unknown as { handleInput(input: string): void }).handleInput(data);
}

function setTask7Keybindings(
  tui: PythinkerTUI,
  blocks: Parameters<typeof parseKeybindingBlocks>[0],
): void {
  const bindings = [...defaultKeybindings(), ...parseKeybindingBlocks(blocks)];
  tui.state.editor.setKeybindings(bindings);
  tui.editorKeyboard.setKeybindings(bindings);
}

function activeGoal() {
  return {
    goalId: 'goal-1',
    objective: 'Ship it',
    status: 'active' as const,
    turnsUsed: 1,
    tokensUsed: 0,
    wallClockMs: 0,
    budget: {
      turnBudget: null,
      tokenBudget: null,
      wallClockBudgetMs: null,
      remainingTokens: null,
      remainingTurns: null,
      remainingWallClockMs: null,
      tokenBudgetReached: false,
      turnBudgetReached: false,
      wallClockBudgetReached: false,
      overBudget: false,
    },
  };
}

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function autocompleteProvider(): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({
      items: [{ value: 'help', label: 'help' }],
      prefix: '',
    })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
      lines,
      cursorLine,
      cursorCol,
    })),
  };
}

function enableMcpStatusAnimationForTest(): void {
  vi.stubEnv('PYTHINKER_NO_ANIMATION', '');
  vi.stubEnv('CI', '');
  vi.stubEnv('NO_COLOR', '');
}

const tempDirs: string[] = [];
const originalPythinkerCodeHome = process.env['PYTHINKER_CODE_HOME'];
const originalPluginMarketplaceUrl = process.env['PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL'];
const originalVisual = process.env['VISUAL'];
const originalEditor = process.env['EDITOR'];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-code-tui-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  resetCapabilitiesCache();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
  if (originalPythinkerCodeHome === undefined) {
    delete process.env['PYTHINKER_CODE_HOME'];
  } else {
    process.env['PYTHINKER_CODE_HOME'] = originalPythinkerCodeHome;
  }
  if (originalVisual === undefined) {
    delete process.env['VISUAL'];
  } else {
    process.env['VISUAL'] = originalVisual;
  }
  if (originalPluginMarketplaceUrl === undefined) {
    delete process.env['PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL'];
  } else {
    process.env['PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL'] = originalPluginMarketplaceUrl;
  }
  if (originalEditor === undefined) {
    delete process.env['EDITOR'];
  } else {
    process.env['EDITOR'] = originalEditor;
  }
});

describe('PythinkerTUI message flow', () => {
  it('settles a local request after a forked skill completes', async () => {
    const session = makeSession({
      activateSkill: vi.fn(async () => ({
        execution: 'fork' as const,
        result: 'Forked review complete.',
      })),
    });
    const { driver } = await makeDriver(session);

    driver.sendSkillActivation(session, 'review', 'current branch');

    expect(driver.state.appState.streamingPhase).toBe('waiting');
    await vi.waitFor(() => {
      expect(driver.state.appState.streamingPhase).toBe('idle');
    });
    expect(session.activateSkill).toHaveBeenCalledWith('review', 'current branch');
  });

  it('searches persisted prompt history with Ctrl-R and restores the selected input', async () => {
    process.env['PYTHINKER_CODE_HOME'] = await makeTempHome();
    const historyFile = getInputHistoryFile('/tmp/proj-a');
    await appendInputHistory(historyFile, 'older prompt');
    await appendInputHistory(historyFile, 'multi\nline prompt');
    const { driver, harness } = await makeDriver();
    harness.track.mockClear();

    driver.state.editor.handleInput('\u0012');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });
    const picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.handleInput('m');
    picker.handleInput('\u001B');

    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
    expect(driver.state.editor.getText()).toBe('multi\nline prompt');
    expect(harness.track).toHaveBeenCalledWith('shortcut_history_search', undefined);
  });

  it('applies remapped prompt-history accept, cancel, and execute semantics', async () => {
    process.env['PYTHINKER_CODE_HOME'] = await makeTempHome();
    const historyFile = getInputHistoryFile('/tmp/proj-a');
    await appendInputHistory(historyFile, 'older prompt');
    await appendInputHistory(historyFile, 'newer prompt');
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    const bindings = parseKeybindingBlocks([
      {
        context: 'HistorySearch',
        bindings: {
          escape: null,
          'ctrl+c': null,
          enter: null,
          'alt+n': 'historySearch:next',
          'alt+a': 'historySearch:accept',
          'alt+c': 'historySearch:cancel',
          'alt+e': 'historySearch:execute',
        },
      },
    ]);

    driver.state.editor.setText('unchanged draft');
    await tui.showInputHistoryPicker();
    let picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.setKeybindings(bindings);
    const hint = stripSgr(picker.render(120).join('\n')).split('\n')[2];
    expect(hint).toContain('alt+a');
    expect(hint).not.toContain('Esc');
    expect(hint).not.toContain('Enter');
    expect(hint).not.toContain('ctrl+c');
    picker.handleInput('\u001B');
    expect(driver.state.editorContainer.children[0]).toBe(picker);
    picker.handleInput('\u001Bn');
    picker.handleInput('\u001Ba');
    expect(driver.state.editor.getText()).toBe('older prompt');

    driver.state.editor.setText('unchanged draft');
    await tui.showInputHistoryPicker();
    picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.setKeybindings(bindings);
    picker.handleInput('\u0003');
    expect(driver.state.editorContainer.children[0]).toBe(picker);
    picker.handleInput('\u001Bc');
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
    expect(driver.state.editor.getText()).toBe('unchanged draft');

    const handleUserInput = vi.spyOn(tui, 'handleUserInput');
    await tui.showInputHistoryPicker();
    picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.setKeybindings(bindings);
    picker.handleInput('\r');
    expect(handleUserInput).not.toHaveBeenCalled();
    picker.handleInput('\u001Bn');
    picker.handleInput('\u001Be');
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
    expect(handleUserInput).toHaveBeenCalledWith('older prompt');
  });

  it('delivers valid keybinding reloads to the active replacement and retains the last valid set', async () => {
    const homeDir = await makeTempHome();
    process.env['PYTHINKER_CODE_HOME'] = homeDir;
    const { driver } = await makeDriver(makeSession(), { homeDir });
    const tui = driver as unknown as PythinkerTUI;
    const panel = {
      focused: false,
      setKeybindings: vi.fn(),
      handleInput: () => {},
      invalidate: () => {},
      render: () => [],
    };
    tui.mountEditorReplacement(panel);

    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [{ context: 'Chat', bindings: { 'alt+j': 'command:second-command' } }],
      }),
      'utf-8',
    );
    tui.reloadKeybindings();

    expect(panel.setKeybindings).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ context: 'Chat', action: 'command:second-command' }),
      ]),
    );

    const deliveries = panel.setKeybindings.mock.calls.length;
    await writeFile(join(homeDir, 'keybindings.json'), '{', 'utf-8');
    tui.reloadKeybindings();

    expect(panel.setKeybindings).toHaveBeenCalledTimes(deliveries);
    tui.restoreEditor();
    const handleUserInput = vi.spyOn(tui, 'handleUserInput');
    driver.state.editor.handleInput('\u001Bj');
    expect(handleUserInput).toHaveBeenCalledWith('/second-command');
  });

  it('enters footer focus after configured history-next reaches the empty lower boundary', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    expect(tui.canFocusFooter()).toBe(true);
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { down: 'history:next' } },
    ]);
    driver.state.editor.addToHistory('previous prompt');
    driver.state.editor.handleInput('\u001B[A');
    expect(driver.state.editor.getText()).toBe('previous prompt');
    session.getGoal.mockClear();

    dispatchTerminalInput(driver, '\u001B[B');

    expect(driver.state.editor.getText()).toBe('');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, '\r');
    expect(driver.state.footer.selectedActionId()).toBeNull();
    await vi.waitFor(() => {
      expect(session.getGoal).toHaveBeenCalledOnce();
    });
  });

  it('enters footer focus through a Global history-next fallback before editor input', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Global', bindings: { j: 'history:next' } },
    ]);
    driver.state.ui.setFocus(driver.state.editor);
    const editorInput = vi.spyOn(driver.state.editor, 'handleInput');

    dispatchTerminalInput(driver, 'j');

    expect(driver.state.footer.selectedActionId()).toBe('goal');
    expect(driver.state.editor.getText()).toBe('');
    expect(editorInput).not.toHaveBeenCalled();
  });

  it('consumes a null Global fallback at the empty history boundary', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Global', bindings: { x: null } },
    ]);
    driver.state.ui.setFocus(driver.state.editor);
    const editorInput = vi.spyOn(driver.state.editor, 'handleInput');

    dispatchTerminalInput(driver, 'x');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(driver.state.editor.getText()).toBe('');
    expect(editorInput).not.toHaveBeenCalled();
  });

  it('navigates selected footer focus through a Global action before editor input', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    driver.state.footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 0 });
    setTask7Keybindings(tui, [
      { context: 'Global', bindings: { j: 'footer:next' } },
    ]);
    driver.state.footer.selectFirst();
    driver.state.ui.setFocus(driver.state.editor);
    const editorInput = vi.spyOn(driver.state.editor, 'handleInput');

    dispatchTerminalInput(driver, 'j');

    expect(driver.state.footer.selectedActionId()).toBe('shell-tasks');
    expect(driver.state.editor.getText()).toBe('');
    expect(editorInput).not.toHaveBeenCalled();
  });

  it('consumes a null Global fallback while footer focus is selected', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Global', bindings: { x: null } },
    ]);
    driver.state.footer.selectFirst();
    driver.state.ui.setFocus(driver.state.editor);
    const editorInput = vi.spyOn(driver.state.editor, 'handleInput');

    dispatchTerminalInput(driver, 'x');

    expect(driver.state.footer.selectedActionId()).toBe('goal');
    expect(driver.state.editor.getText()).toBe('');
    expect(editorInput).not.toHaveBeenCalled();
  });

  it('honors null, raw, and semantic footer remaps without stealing printable input', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    driver.state.footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });
    setTask7Keybindings(tui, [
      {
        context: 'Chat',
        bindings: {
          down: null,
          'alt+n': 'history:next',
          'ctrl+k ctrl+n': 'history:next',
        },
      },
      {
        context: 'Footer',
        bindings: {
          down: null,
          right: null,
          escape: null,
          'alt+j': 'footer:next',
          'alt+x': 'footer:clearSelection',
          'ctrl+k ctrl+j': 'footer:next',
          'q x': 'chat:submit',
        },
      },
    ]);
    driver.state.ui.setFocus(driver.state.editor);

    dispatchTerminalInput(driver, '\u001B[B');
    expect(driver.state.footer.selectedActionId()).toBeNull();
    dispatchTerminalInput(driver, '\u001Bn');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, 'ctrl+k');
    dispatchTerminalInput(driver, 'ctrl+j');
    expect(driver.state.footer.selectedActionId()).toBe('shell-tasks');
    dispatchTerminalInput(driver, '\u001Bj');
    expect(driver.state.footer.selectedActionId()).toBe('agents');
    dispatchTerminalInput(driver, '\u001B');
    expect(driver.state.footer.selectedActionId()).toBeNull();
    dispatchTerminalInput(driver, 'ctrl+k');
    dispatchTerminalInput(driver, 'ctrl+n');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, '\u001Bx');
    expect(driver.state.footer.selectedActionId()).toBeNull();

    dispatchTerminalInput(driver, 'ctrl+k');
    dispatchTerminalInput(driver, 'ctrl+n');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, 'q');
    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(driver.state.editor.getText()).toBe('q');
  });

  it('prefers an effective printable Footer action over the Chat binding', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    driver.state.footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 0 });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next', j: 'chat:submit' } },
      { context: 'Footer', bindings: { j: 'footer:next' } },
    ]);

    dispatchTerminalInput(driver, '\u001Bn');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, 'j');

    expect(driver.state.footer.selectedActionId()).toBe('shell-tasks');
    expect(driver.state.editor.getText()).toBe('');
  });

  it('passes an unshadowed printable Chat binding through after clearing footer focus', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next', j: 'chat:newline' } },
    ]);
    driver.state.ui.setFocus(driver.state.editor);

    dispatchTerminalInput(driver, '\u001Bn');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    dispatchTerminalInput(driver, 'j');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(driver.state.editor.getText()).toBe('\n');
  });

  it('preserves normal multiline Down behavior when footer actions are available', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next' } },
    ]);
    driver.state.ui.setFocus(driver.state.editor);
    driver.state.editor.setText('first\nsecond');
    driver.state.editor.handleInput('\u001B[A');
    expect(driver.state.editor.getCursor()).toEqual({ line: 0, col: 5 });

    dispatchTerminalInput(driver, '\u001Bn');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(driver.state.editor.getCursor()).toEqual({ line: 1, col: 6 });
  });

  it('does not consume non-history Chat chord prefixes while footer focus is available', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'ctrl+k ctrl+x': 'chat:newline' } },
    ]);

    const handleFooterInput = (
      tui.editorKeyboard as unknown as {
        handleFooterInput(data: string): { consume: boolean } | undefined;
      }
    ).handleFooterInput.bind(tui.editorKeyboard);

    expect(handleFooterInput('\u000B')).toBeUndefined();
    expect(handleFooterInput('\u0018')).toBeUndefined();
    expect(driver.state.footer.selectedActionId()).toBeNull();
  });

  it('opens both task badges through the native tasks browser', async () => {
    const session = makeSession({
      listBackgroundTasks: vi.fn(async () => []),
    });
    const { driver } = await makeDriver(session);
    const tui = driver as unknown as PythinkerTUI;
    driver.state.footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next' } },
      {
        context: 'Footer',
        bindings: {
          'alt+j': 'footer:next',
          'alt+o': 'footer:openSelected',
        },
      },
    ]);

    dispatchTerminalInput(driver, '\u001Bn');
    dispatchTerminalInput(driver, '\u001Bo');
    await vi.waitFor(() => {
      expect(driver.state.tasksBrowser).toBeDefined();
    });
    tui.tasksBrowserController.close();

    dispatchTerminalInput(driver, '\u001Bn');
    dispatchTerminalInput(driver, '\u001Bj');
    dispatchTerminalInput(driver, '\u001Bo');
    await vi.waitFor(() => {
      expect(driver.state.tasksBrowser).toBeDefined();
    });
    expect(session.listBackgroundTasks).toHaveBeenCalledTimes(2);
    tui.tasksBrowserController.close();
  });

  it.each([
    'replacement dialog',
    'autocomplete',
    'compaction',
    'task browser',
    'BTW panel',
  ])('does not enter footer focus while %s is active', async (surface) => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    const tui = driver as unknown as PythinkerTUI;
    driver.state.footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 0 });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next' } },
    ]);
    let autocompleteActive = surface !== 'autocomplete';

    if (surface === 'replacement dialog') {
      tui.mountEditorReplacement({
        focused: false,
        invalidate: () => {},
        render: () => [],
        handleInput: () => {},
      });
    } else if (surface === 'autocomplete') {
      driver.state.editor.setAutocompleteProvider(autocompleteProvider());
      driver.state.editor.handleInput('/');
      await flushAutocomplete();
      autocompleteActive = driver.state.editor.isShowingAutocomplete();
    } else if (surface === 'compaction') {
      tui.setAppState({ isCompacting: true });
    } else if (surface === 'task browser') {
      tui.setTasksBrowser({} as never);
    } else {
      await openBtwPanel(driver, session);
    }

    expect(autocompleteActive).toBe(true);
    dispatchTerminalInput(driver, '\u001Bn');

    expect(driver.state.footer.selectedActionId()).toBeNull();
  });

  it('does not enter footer focus while a generic UI overlay is active', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next' } },
    ]);
    const overlay = driver.state.ui.showOverlay({
      invalidate: () => {},
      render: () => [],
    });
    expect(driver.state.ui.hasOverlay()).toBe(true);

    dispatchTerminalInput(driver, '\u001Bn');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    overlay.hide();
  });

  it('passes pending history chords to an overlay and clears stale footer focus', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'ctrl+k ctrl+n': 'history:next', 'alt+n': 'history:next' } },
    ]);
    const received: string[] = [];
    const overlay = driver.state.ui.showOverlay({
      invalidate: () => {},
      render: () => [],
      handleInput: (data) => received.push(data),
    });

    dispatchTerminalInput(driver, 'ctrl+k');
    dispatchTerminalInput(driver, 'ctrl+n');
    overlay.hide();
    dispatchTerminalInput(driver, 'ctrl+n');

    expect(received).toEqual(['ctrl+k', 'ctrl+n']);
    expect(driver.state.footer.selectedActionId()).toBeNull();
  });

  it('releases footer input to an overlay that appears after selection', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    tui.setAppState({ goal: activeGoal() });
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { 'alt+n': 'history:next' } },
    ]);
    dispatchTerminalInput(driver, '\u001Bn');
    expect(driver.state.footer.selectedActionId()).toBe('goal');
    const received: string[] = [];
    const overlay = driver.state.ui.showOverlay({
      invalidate: () => {},
      render: () => [],
      handleInput: (data) => received.push(data),
    });

    dispatchTerminalInput(driver, '\r');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(received).toEqual(['\r']);
    overlay.hide();
  });

  it('keeps the editor active at the lower boundary when no footer action exists', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    setTask7Keybindings(tui, [
      { context: 'Chat', bindings: { down: 'history:next' } },
    ]);

    dispatchTerminalInput(driver, '\u001B[B');

    expect(driver.state.footer.selectedActionId()).toBeNull();
    expect(driver.state.editor.getText()).toBe('');
  });

  it('delivers remapped confirmation bindings to mounted permission prompts', async () => {
    const homeDir = await makeTempHome();
    process.env['PYTHINKER_CODE_HOME'] = homeDir;
    const { driver } = await makeDriver(makeSession(), { homeDir });
    const tui = driver as unknown as PythinkerTUI;
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Confirmation',
            bindings: {
              y: null,
              n: null,
              enter: null,
              escape: null,
              up: null,
              down: null,
              'alt+p': 'confirm:previous',
              'alt+n': 'confirm:next',
              'alt+y': 'confirm:yes',
              'alt+x': 'confirm:no',
            },
          },
        ],
      }),
      'utf-8',
    );
    tui.reloadKeybindings();

    const choices: string[] = [];
    const prompt = new StartPermissionPromptComponent({
      title: 'Choose permission mode',
      noticeLines: [],
      options: [
        { value: 'auto', label: 'Auto', description: 'Approve safe actions.' },
        { value: 'yolo', label: 'YOLO', description: 'Approve all actions.' },
      ],
      onSelect: (choice) => choices.push(choice),
      onCancel: () => choices.push('cancel'),
    });
    tui.mountEditorReplacement(prompt);

    const hint = stripSgr(prompt.render(80).join('\n'));
    expect(hint).toContain('alt+n navigate');
    expect(hint).toContain('alt+y select');
    expect(hint).toContain('alt+x cancel');
    prompt.handleInput('\u001Bn');
    prompt.handleInput('\u001By');
    expect(choices).toEqual(['yolo']);

    prompt.handleInput('\u001Bx');
    expect(choices).toEqual(['yolo', 'cancel']);

    const recovered: string[] = [];
    const recoveryPrompt = new StartPermissionPromptComponent({
      title: 'Choose permission mode',
      noticeLines: [],
      options: [
        { value: 'auto', label: 'Auto', description: 'Approve safe actions.' },
        { value: 'yolo', label: 'YOLO', description: 'Approve all actions.' },
      ],
      onSelect: (choice) => recovered.push(choice),
      onCancel: () => recovered.push('cancel'),
    });
    recoveryPrompt.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { n: null, escape: null } },
      ]),
    ]);
    recoveryPrompt.handleInput('\u001B');
    expect(recovered).toEqual(['cancel']);

    const semantic: string[] = [];
    const semanticPrompt = new StartPermissionPromptComponent({
      title: 'Choose permission mode',
      noticeLines: [],
      options: [
        { value: 'auto', label: 'Auto', description: 'Approve safe actions.' },
        { value: 'yolo', label: 'YOLO', description: 'Approve all actions.' },
      ],
      onSelect: (choice) => semantic.push(choice),
      onCancel: () => semantic.push('cancel'),
    });
    semanticPrompt.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+k ctrl+n': 'confirm:next',
            'ctrl+k ctrl+y': 'confirm:yes',
            'ctrl+k ctrl+x': 'confirm:no',
          },
        },
      ]),
    );
    semanticPrompt.handleInput('ctrl+k');
    semanticPrompt.handleInput('ctrl+n');
    semanticPrompt.handleInput('ctrl+k');
    semanticPrompt.handleInput('ctrl+y');
    semanticPrompt.handleInput('ctrl+k');
    semanticPrompt.handleInput('ctrl+x');
    expect(semantic).toEqual(['yolo', 'cancel']);
  });

  it('tracks editor shortcut and paste hooks', async () => {
    const { driver, harness } = await makeDriver();
    harness.track.mockClear();

    driver.state.editor.handleInput('\u001B[106;5u');
    driver.state.editor.handleInput('\u001F');
    delete process.env['VISUAL'];
    delete process.env['EDITOR'];
    driver.state.editor.onOpenExternalEditor?.();
    driver.state.editor.onToggleToolExpand?.();
    driver.state.editor.onTextPaste?.();

    expect(harness.track).toHaveBeenCalledWith('shortcut_newline', undefined);
    expect(harness.track).toHaveBeenCalledWith('undo', undefined);
    expect(harness.track).toHaveBeenCalledWith('shortcut_editor', undefined);
    expect(harness.track).toHaveBeenCalledWith('shortcut_expand', undefined);
    expect(harness.track).toHaveBeenCalledWith('shortcut_paste', { kind: 'text' });
  });

  it('tracks /clear as the clear alias for /new', async () => {
    const { driver, harness } = await makeDriver(makeSession({ id: 'ses-1' }));
    const nextSession = makeSession({ id: 'ses-2' });
    harness.createSession.mockResolvedValueOnce(nextSession);
    harness.track.mockClear();

    driver.handleUserInput('/clear');

    await vi.waitFor(() => {
      expect(driver.getCurrentSessionId()).toBe('ses-2');
    });
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'new' });
    expect(harness.track).toHaveBeenCalledWith('clear', undefined);
  });

  it('tracks theme changes from slash commands', async () => {
    process.env['PYTHINKER_CODE_HOME'] = await makeTempHome();
    const { driver, harness } = await makeDriver();
    harness.track.mockClear();

    driver.handleUserInput('/theme light');

    await vi.waitFor(() => {
      expect(driver.state.appState.theme).toBe('light');
    });
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'theme' });
    expect(harness.track).toHaveBeenCalledWith('theme_switch', { theme: 'light' });
  });

  it('dispatches /reload-tui without reloading the active session', async () => {
    const homeDir = await makeTempHome();
    process.env['PYTHINKER_CODE_HOME'] = homeDir;
    await writeFile(
      join(homeDir, 'tui.toml'),
      `
theme = "light"

[editor]
command = "vim"
`,
      'utf-8',
    );
    const { driver, session, harness } = await makeDriver();
    harness.track.mockClear();
    session.reloadSession.mockClear();

    driver.handleUserInput('/reload-tui');

    await vi.waitFor(() => {
      expect(driver.state.appState.theme).toBe('light');
    });
    expect(driver.state.appState.editorCommand).toBe('vim');
    expect(session.reloadSession).not.toHaveBeenCalled();
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'reload-tui' });
  });

  it('dispatches /reload through session reload and applies tui.toml', async () => {
    const homeDir = await makeTempHome();
    process.env['PYTHINKER_CODE_HOME'] = homeDir;
    await writeFile(join(homeDir, 'tui.toml'), 'theme = "light"\n', 'utf-8');
    const { driver, session, harness } = await makeDriver();
    harness.track.mockClear();
    session.reloadSession.mockClear();
    driver.handleUserInput('hello before reload');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/reload');

    await vi.waitFor(() => {
      expect(session.reloadSession).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(driver.state.appState.theme).toBe('light');
    });
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'reload' });
    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('hello before reload');
    expect(transcript).toContain('Session reloaded.');
  });



  it('does not track feedback when the dialog is cancelled', async () => {
    const { driver, harness } = await makeDriver(
      makeSession(),
      {
        getConfig: vi.fn(async () => ({
          models: {
            k2: {
              model: 'pythoughts-v1',
              maxContextSize: 100,
              provider: 'managed:kimi-code',
            },
          },
        })),
      },
    );
    const feedbackDriver = driver as unknown as FeedbackDriver;
    vi.mocked(promptFeedbackInput).mockImplementation(async () => undefined);
    harness.track.mockClear();

    await handleFeedbackCommand(feedbackDriver as any);

    expect(harness.auth.submitFeedback).not.toHaveBeenCalled();
    expect(harness.track).not.toHaveBeenCalledWith('feedback_submitted', undefined);
  });

  it('tracks blocked slash commands as invalid without counting them as executed commands', async () => {
    const { driver, harness } = await makeDriver();
    driver.state.appState.streamingPhase = 'waiting';

    for (const command of ['/new', '/sessions']) {
      harness.track.mockClear();

      driver.handleUserInput(command);
      await Promise.resolve();

      expect(harness.track).toHaveBeenCalledWith('input_command_invalid', {
        reason: 'blocked',
        command: command.slice(1),
      });
      expect(harness.track).not.toHaveBeenCalledWith('input_command', {
        command: command.slice(1),
      });
    }
  });

  it('does not re-enter plan mode after creating a plan-mode session', async () => {
    const session = makeSession({
      getStatus: vi.fn(async () => ({
        model: 'k2',
        thinkingLevel: 'off',
        permission: 'manual',
        planMode: true,
        contextTokens: 0,
        maxContextTokens: 100,
        contextUsage: 0,
      })),
      setPlanMode: vi.fn(async () => {
        throw new Error('Already in plan mode');
      }),
    });
    const { driver, harness } = await makeDriver(session);
    harness.createSession.mockClear();
    session.setPlanMode.mockClear();
    driver.state.appState.planMode = true;

    driver.handleUserInput('/new');

    await vi.waitFor(() => {
      expect(harness.createSession).toHaveBeenCalledWith({
        workDir: '/tmp/proj-a',
        model: 'k2',
        thinking: 'off',
        permission: 'manual',
        planMode: true,
      });
    });
    expect(session.setPlanMode).not.toHaveBeenCalled();
    expect(stripSgr(renderTranscript(driver))).not.toContain('Post-create setup failed');
  });

  it('keeps the new session subscribed when post-create setup fails', async () => {
    const initialSession = makeSession({ id: 'ses-initial' });
    const failedSession = makeSession({
      id: 'ses-failed',
      setPermission: vi.fn(async () => {
        throw new Error('permission setup failed');
      }),
    });
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(initialSession)
      .mockResolvedValueOnce(failedSession);
    const { driver } = await makeDriver(initialSession, { createSession });
    vi.mocked(failedSession.onEvent).mockClear();

    driver.handleUserInput('/new');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Post-create setup failed: permission setup failed',
      );
    });
    expect(failedSession.onEvent).toHaveBeenCalledOnce();
  });

  it('routes /yolo through session permission state without app-layer telemetry duplication', async () => {
    const { driver, session, harness } = await makeDriver();
    harness.track.mockClear();

    driver.handleUserInput('/yolo on');

    await vi.waitFor(() => {
      expect(session.setPermission).toHaveBeenCalledWith('yolo');
    });
    expect(driver.state.appState).toMatchObject({
      permissionMode: 'yolo',
    });
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'yolo' });
    expect(harness.track).not.toHaveBeenCalledWith('yolo_toggle', expect.anything());
  });

  it('hydrates MCP server status after subscribing to session events', async () => {
    const session = makeSession({
      listMcpServers: vi.fn(async () => [
        {
          name: 'local-tools',
          transport: 'stdio',
          status: 'connected',
          toolCount: 2,
        },
        {
          name: 'remote-tools',
          transport: 'http',
          status: 'failed',
          toolCount: 0,
          error: 'connection refused',
        },
      ]),
    });
    const { driver } = await makeDriver(session);
    enableMcpStatusAnimationForTest();

    driver.sessionEventHandler.startSubscription();
    await Promise.resolve();

    expect(session.onEvent).toHaveBeenCalledOnce();
    expect(session.listMcpServers).toHaveBeenCalledOnce();
    const subscribeOrder = session.onEvent.mock.invocationCallOrder[0];
    const snapshotOrder = session.listMcpServers.mock.invocationCallOrder[0];
    if (subscribeOrder === undefined || snapshotOrder === undefined) {
      throw new Error('Expected MCP status sync to subscribe and fetch a snapshot.');
    }
    expect(subscribeOrder).toBeLessThan(snapshotOrder);
    const status = stripSgr(renderMcpStatus(driver));
    const transcript = stripSgr(renderTranscript(driver));
    expect(status).toContain(
      '✗ MCP servers · 1/2 connected · 1 failed · /mcp for details',
    );
    expect(countOccurrences(status, 'MCP servers')).toBe(1);
    expect(status).not.toContain('local-tools');
    expect(status).not.toContain('remote-tools');
    expect(transcript).not.toContain('MCP servers');
  });

  it('deduplicates identical MCP status updates while allowing reconnect transitions', async () => {
    const eventListeners: Array<(event: Event) => void> = [];
    const connectedServer = {
      name: 'local-tools',
      transport: 'stdio',
      status: 'connected',
      toolCount: 2,
    };
    const session = makeSession({
      onEvent: vi.fn((listener: (event: Event) => void) => {
        eventListeners.push(listener);
        return vi.fn();
      }),
      listMcpServers: vi.fn(async () => [connectedServer]),
    });
    const { driver } = await makeDriver(session);
    enableMcpStatusAnimationForTest();

    driver.sessionEventHandler.startSubscription();
    await Promise.resolve();
    eventListeners[0]?.({
      type: 'mcp.server.status',
      agentId: 'main',
      sessionId: 'ses-1',
      server: connectedServer,
    } as Event);

    expect(countOccurrences(stripSgr(renderMcpStatus(driver)), 'MCP servers')).toBe(1);

    eventListeners[0]?.({
      type: 'mcp.server.status',
      agentId: 'main',
      sessionId: 'ses-1',
      server: {
        ...connectedServer,
        status: 'pending',
        toolCount: 0,
      },
    } as Event);
    eventListeners[0]?.({
      type: 'mcp.server.status',
      agentId: 'main',
      sessionId: 'ses-1',
      server: connectedServer,
    } as Event);

    const status = stripSgr(renderMcpStatus(driver));
    expect(countOccurrences(status, 'MCP servers')).toBe(1);
    expect(status).toContain('✓ MCP servers · 1/1 connected · 2 tools');
    expect(stripSgr(renderTranscript(driver))).not.toContain('MCP servers');
  });

  it('does not let a late MCP snapshot overwrite a live status event', async () => {
    const eventListeners: Array<(event: Event) => void> = [];
    let resolveSnapshot: (
      servers: Array<{
        name: string;
        transport: 'stdio' | 'http' | 'sse';
        status: 'pending' | 'connected' | 'failed' | 'disabled';
        toolCount: number;
        error?: string;
      }>,
    ) => void = () => {};
    const snapshot = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const session = makeSession({
      onEvent: vi.fn((listener: (event: Event) => void) => {
        eventListeners.push(listener);
        return vi.fn();
      }),
      listMcpServers: vi.fn(() => snapshot),
    });
    const { driver } = await makeDriver(session);
    enableMcpStatusAnimationForTest();

    driver.sessionEventHandler.startSubscription();
    eventListeners[0]?.({
      type: 'mcp.server.status',
      agentId: 'main',
      sessionId: 'ses-1',
      server: {
        name: 'local-tools',
        transport: 'stdio',
        status: 'connected',
        toolCount: 2,
      },
    } as Event);
    resolveSnapshot([
      {
        name: 'local-tools',
        transport: 'stdio',
        status: 'failed',
        toolCount: 0,
        error: 'stale failure',
      },
    ]);
    await Promise.resolve();

    const status = stripSgr(renderMcpStatus(driver));
    expect(status).toContain('✓ MCP servers · 1/1 connected · 2 tools');
    expect(countOccurrences(status, 'MCP servers')).toBe(1);
    expect(status).not.toContain('stale failure');
    expect(stripSgr(renderTranscript(driver))).not.toContain('MCP servers');
  });

  it('sends normal editor input to the active session and marks the turn as waiting', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('hello');

    expect(session.prompt).toHaveBeenCalledWith('hello');
    expect(driver.state.appState.streamingPhase).not.toBe('idle');
    expect(driver.state.appState.streamingPhase).toBe('waiting');
    expect(driver.state.livePane.mode).toBe('waiting');
    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: 'hello',
      }),
    ]);
  });

  it('keeps the transcript intact when undo RPC fails', async () => {
    const session = makeSession({
      undoHistory: vi.fn(async () => {
        throw new Error('core rpc unavailable');
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });
    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Error: Failed to undo: core rpc unavailable',
      );
    });

    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: 'hello',
      }),
    ]);
    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('hello');
  });

  it('does not duplicate welcome after undoing the only turn', async () => {
    const { driver } = await makeDriver();

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(driver.state.transcriptEntries).toEqual([]);
    });

    expect(
      driver.state.transcriptContainer.children.filter(
        (child) => child instanceof WelcomeComponent,
      ),
    ).toHaveLength(1);
  });

  it('keeps command notices that are not part of the undone context', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/auto on');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain('Auto mode: ON');
    });

    driver.handleUserInput('/undo 10');
    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Cannot undo 10 prompts; only 1 prompt can be undone in the active context.',
      );
    });

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('hello');
    expect(transcript).not.toContain('Cannot undo 10 prompts');
    expect(transcript).toContain('Auto mode: ON');
    expect(driver.state.appState.permissionMode).toBe('auto');
  });

  it('removes turn-scoped background status entries and restores welcome', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';
    driver.sessionEventHandler.handleEvent(
      {
        type: 'background.task.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        info: {
          kind: 'process',
          taskId: 'bash-bg123456',
          command: 'npm test',
          description: 'Run tests in background',
          status: 'running',
          pid: 1234,
          exitCode: null,
          startedAt: Date.now(),
          endedAt: null,
        },
      } as Event,
      () => {},
    );

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('bash task started in background');
      expect(transcript).toContain('Run tests in background');
    });

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });

    const transcript = stripSgr(renderTranscript(driver));
    expect(driver.state.transcriptEntries).toEqual([]);
    expect(transcript).not.toContain('hello');
    expect(transcript).not.toContain('bash task started in background');
    expect(transcript).not.toContain('Run tests in background');
    expect(
      driver.state.transcriptContainer.children.filter(
        (child) => child instanceof WelcomeComponent,
      ),
    ).toHaveLength(1);
  });

  it('removes Dynamic Workflow mission control from undone turns', async () => {
    const { driver, session } = await makeDriver();
    const sendQueued = vi.fn();

    driver.handleUserInput('launch swarm');
    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_dynamic_workflow',
        name: 'DynamicWorkflow',
        args: {
          description: 'Review changed files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts'],
        },
      } as Event,
      sendQueued,
    );

    let transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('launch swarm');
    expect(transcript).toContain('Dynamic Workflow');
    expect(transcript).toContain('Review changed files');
    expect(
      driver.sessionEventHandler.hasDynamicWorkflowMissionControl('call_dynamic_workflow'),
    ).toBe(true);

    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });

    transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('launch swarm');
    expect(transcript).not.toContain('Dynamic Workflow');
    expect(transcript).not.toContain('Review changed files');
    expect(
      driver.sessionEventHandler.hasDynamicWorkflowMissionControl('call_dynamic_workflow'),
    ).toBe(false);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_dynamic_workflow',
        name: 'DynamicWorkflow',
        args: { description: 'Late recreated workflow', items: ['Late work'] },
      } as Event,
      sendQueued,
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_dynamic_workflow',
        name: 'DynamicWorkflow',
        argumentsPart: '{"description":"Late streamed workflow"}',
      } as Event,
      sendQueued,
    );
    expect(
      driver.sessionEventHandler.hasDynamicWorkflowMissionControl('call_dynamic_workflow'),
    ).toBe(false);
    expect(stripSgr(renderTranscript(driver))).not.toContain('Late recreated workflow');
    expect(stripSgr(renderTranscript(driver))).not.toContain('Late streamed workflow');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'subagent.spawned',
        agentId: 'main',
        sessionId: 'ses-1',
        parentToolCallId: 'call_dynamic_workflow',
        subagentId: 'late-agent',
        subagentName: 'coder',
        dynamicWorkflowIndex: 1,
        runInBackground: false,
      } as Event,
      sendQueued,
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'late-agent',
        sessionId: 'ses-1',
        turnId: 1,
        delta: 'Late output from undone work',
      } as Event,
      sendQueued,
    );

    transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('Late output from undone work');
    expect(transcript).not.toContain('Review changed files');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 2,
        toolCallId: 'call_fresh_dynamic_workflow',
        name: 'DynamicWorkflow',
        args: { description: 'Fresh workflow', items: ['Fresh work'] },
      } as Event,
      sendQueued,
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'subagent.spawned',
        agentId: 'main',
        sessionId: 'ses-1',
        parentToolCallId: 'call_fresh_dynamic_workflow',
        subagentId: 'late-agent',
        subagentName: 'coder',
        dynamicWorkflowIndex: 1,
        runInBackground: false,
      } as Event,
      sendQueued,
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'subagent.completed',
        agentId: 'main',
        sessionId: 'ses-1',
        subagentId: 'late-agent',
        parentToolCallId: 'call_dynamic_workflow',
        resultSummary: 'Late completion from undone work',
      } as Event,
      sendQueued,
    );

    transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toMatch(/001\s+○\s+WAIT\s+Fresh work/u);
    expect(transcript).not.toContain('Late completion from undone work');
  });

  it('removes approval notices from undone turns', async () => {
    const { driver, session } = await makeDriver();
    const approvalHandler = vi.mocked(session.setApprovalHandler).mock.calls[0]?.[0] as
      | ((request: ApprovalRequest) => Promise<ApprovalResponse>)
      | undefined;
    if (approvalHandler === undefined) throw new Error('expected approval handler');

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';
    const response = approvalHandler({
      turnId: 1,
      toolCallId: 'call_bash',
      toolName: 'Bash',
      action: 'Run shell command',
      display: {
        kind: 'generic',
        summary: 'Run shell command',
        detail: { command: 'echo ok', description: 'Run a shell command' },
      },
    });

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ApprovalPanelComponent);
    });
    (driver.state.editorContainer.children[0] as ApprovalPanelComponent).handleInput('1');
    await expect(response).resolves.toMatchObject({ decision: 'approved' });

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain('Approved: Run shell command');
    });

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('hello');
    expect(transcript).not.toContain('Approved: Run shell command');
  });

  it('undoes multiple turns when a count is provided', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('first');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('second');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('third');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo 2');

    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(2);
    });

    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: 'first',
      }),
    ]);
    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('first');
    expect(transcript).not.toContain('second');
    expect(transcript).not.toContain('third');
  });

  it('summarizes from a selected prompt and restores it for editing', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('first');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('second');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo');
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(UndoSelectorComponent);
    });
    (driver.state.editorContainer.children[0] as UndoSelectorComponent).handleInput('s');

    await vi.waitFor(() => {
      expect(session.compact).toHaveBeenCalledWith({
        promptFromEnd: 1,
        direction: 'from',
      });
    });
    expect(driver.state.editor.getText()).toBe('second');
    expect(session.undoHistory).not.toHaveBeenCalled();
  });

  it('summarizes up to an earlier selected prompt without restoring it', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('first');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('second');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('third');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo');
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(UndoSelectorComponent);
    });
    const selector = driver.state.editorContainer.children[0] as UndoSelectorComponent;
    selector.setKeybindings(defaultKeybindings());
    selector.handleInput('\u001B[A');
    selector.handleInput('u');

    await vi.waitFor(() => {
      expect(session.compact).toHaveBeenCalledWith({
        promptFromEnd: 2,
        direction: 'up_to',
      });
    });
    expect(driver.state.editor.getText()).toBe('');
    expect(session.undoHistory).not.toHaveBeenCalled();
  });

  it('uses remapped MessageSelector actions while keeping code-only summary keys local', () => {
    const selected: string[] = [];
    const summarized: string[] = [];
    const cancelled: string[] = [];
    const raw = new UndoSelectorComponent({
      choices: [
        { id: 'first', count: 2, input: 'first', label: 'First' },
        { id: 'middle', count: 1, input: 'middle', label: 'Middle' },
        { id: 'last', count: 1, input: 'last', label: 'Last' },
      ],
      onSelect: () => {},
      onSummarize: () => {},
      onCancel: () => {},
    });
    raw.handleInput('\u001B[A');
    expect(stripSgr(raw.render(120).join('\n'))).toContain('❯ Middle');
    const selector = new UndoSelectorComponent({
      choices: [
        { id: 'first', count: 2, input: 'first', label: 'First' },
        { id: 'code', input: '', label: 'Code only' },
        { id: 'last', count: 1, input: 'last', label: 'Last' },
      ],
      onSelect: (choice) => selected.push(choice.id),
      onSummarize: (choice) => summarized.push(choice.id),
      onCancel: () => cancelled.push('cancel'),
    });
    selector.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        {
          context: 'MessageSelector',
          bindings: {
            up: null,
            down: null,
            enter: null,
            'alt+u': 'messageSelector:up',
            'alt+n': 'messageSelector:down',
            'alt+t': 'messageSelector:top',
            'alt+b': 'messageSelector:bottom',
            'alt+s': 'messageSelector:select',
          },
        },
        { context: 'Confirmation', bindings: { escape: null, 'alt+x': 'confirm:no' } },
      ]),
    ]);

    selector.handleInput('\u001B[A');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ Last');
    selector.handleInput('\u001B[B');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ Last');
    selector.handleInput('\u001Bt');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ First');
    selector.handleInput('\u001Bn');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ Code only');
    selector.handleInput('\u001Bb');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ Last');
    selector.handleInput('\u001Bu');
    expect(stripSgr(selector.render(120).join('\n'))).toContain('❯ Code only');
    selector.handleInput('s');
    expect(summarized).toEqual([]);
    selector.handleInput('\u001Bs');
    expect(selected).toEqual(['code']);

    const cancellable = new UndoSelectorComponent({
      choices: [{ id: 'only', count: 1, input: 'only', label: 'Only' }],
      onSelect: () => {},
      onSummarize: () => {},
      onCancel: () => cancelled.push('cancel'),
    });
    cancellable.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { escape: null, 'alt+x': 'confirm:no' } },
      ]),
    ]);
    cancellable.handleInput('\u001B');
    expect(cancelled).toEqual([]);
    cancellable.handleInput('\u001Bx');
    expect(cancelled).toEqual(['cancel']);

    const paging = new UndoSelectorComponent({
      choices: Array.from({ length: 12 }, (_, index) => ({
        id: `point-${String(index + 1)}`,
        count: 1,
        input: `point ${String(index + 1)}`,
        label: `Point ${String(index + 1)}`,
      })),
      onSelect: () => {},
      onSummarize: () => {},
      onCancel: () => {},
    });
    paging.handleInput(`${ESC}[5~`);
    expect(stripSgr(paging.render(120).join('\n'))).toContain('❯ Point 4');
    paging.handleInput(`${ESC}[6~`);
    expect(stripSgr(paging.render(120).join('\n'))).toContain('❯ Point 12');

    const localSummary = new UndoSelectorComponent({
      choices: [{ id: 'summary', count: 1, input: 'summary', label: 'Summary' }],
      onSelect: () => {},
      onSummarize: (choice) => summarized.push(choice.id),
      onCancel: () => {},
    });
    localSummary.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        {
          context: 'MessageSelector',
          bindings: { 's x': 'messageActions:enter' },
        },
      ]),
    ]);
    localSummary.handleInput('s');
    expect(summarized).toEqual(['summary']);

    const hintless = new UndoSelectorComponent({
      choices: [{ id: 'hint', count: 1, input: 'hint', label: 'Hint' }],
      onSelect: () => {},
      onSummarize: () => {},
      onCancel: () => {},
    });
    hintless.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'MessageSelector',
          bindings: { up: null, down: null, enter: null },
        },
        { context: 'Confirmation', bindings: { escape: null } },
      ]),
    );
    expect(stripSgr(hintless.render(120)[2] ?? '').trim()).toBe(
      'S summarize from · U summarize up to',
    );
  });

  it('preserves the editor draft when message actions are cancelled', async () => {
    const { driver } = await makeDriver();
    const tui = driver as unknown as PythinkerTUI;
    driver.handleUserInput('select this transcript entry');
    driver.state.appState.streamingPhase = 'idle';
    driver.state.editor.setText('keep this draft');

    tui.showMessageActions();
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });
    (driver.state.editorContainer.children[0] as ChoicePickerComponent).handleInput('\u001B');

    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
    expect(driver.state.editor.getText()).toBe('keep this draft');
  });

  it('uses persisted checkpoint IDs and ignores summarize keys for code-only history', async () => {
    const session = makeSession({
      getContext: vi.fn(async () => ({
        history: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'before compaction' }],
            origin: { kind: 'user', checkpointId: 'checkpoint-old' },
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'summary' }],
            origin: { kind: 'compaction_summary' },
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'active prompt' }],
            origin: { kind: 'user', checkpointId: 'checkpoint-active' },
          },
        ],
      })),
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-old',
          kind: 'user' as const,
          createdAt: '2026-07-30T11:00:00.000Z',
          prompt: 'before compaction',
          complete: true,
          changedPaths: ['src/old.ts'],
        },
        {
          id: 'checkpoint-active',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'active prompt',
          complete: true,
          changedPaths: [],
        },
      ]),
      previewFileCheckpoint: vi.fn(async (checkpointId: string) => ({
        checkpointId,
        complete: true,
        paths: [{ path: 'src/old.ts', insertions: 2, deletions: 1, modeChanged: false }],
        insertions: 2,
        deletions: 1,
        conversationAvailable: false,
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('active prompt');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(UndoSelectorComponent);
    });
    const selector = driver.state.editorContainer.children[0] as UndoSelectorComponent;
    const rows = stripSgr(selector.render(120).join('\n'));
    expect(rows).toContain('before compaction');
    expect(rows).toContain('active prompt');

    selector.handleInput('\u001B[A');
    selector.handleInput('s');
    selector.handleInput('u');
    expect(session.compact).not.toHaveBeenCalled();

    selector.handleInput('\r');
    await vi.waitFor(() => {
      expect(session.previewFileCheckpoint).toHaveBeenCalledWith('checkpoint-old');
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });

    const picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    const options = (
      picker as unknown as {
        opts: { options: readonly { value: string }[] };
      }
    ).opts.options.map((option) => option.value);
    expect(options).toEqual(['code', 'cancel']);
  });

  it('undoes the conversation directly when a checkpoint has no tracked file changes', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-empty',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'hello',
          complete: true,
          changedPaths: [],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-empty',
        complete: true,
        paths: [],
        insertions: 0,
        deletions: 0,
        conversationAvailable: true,
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(session.previewFileCheckpoint).toHaveBeenCalledWith('checkpoint-empty');
      expect(session.undoHistory).toHaveBeenCalledWith(1);
      expect(driver.state.editor.getText()).toBe('hello');
    });
    expect(session.restoreFileCheckpoint).not.toHaveBeenCalled();
  });

  it('shows exact restore actions and checkpoint diff statistics', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-files',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'change files',
          complete: true,
          changedPaths: ['src/a.ts', 'src/b.ts'],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-files',
        complete: true,
        paths: [
          { path: 'src/a.ts', insertions: 4, deletions: 1, modeChanged: false },
          { path: 'src/b.ts', insertions: 3, deletions: 2, modeChanged: true },
        ],
        insertions: 7,
        deletions: 3,
        conversationAvailable: true,
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('change files');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });
    const picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    const options = (
      picker as unknown as {
        opts: { options: readonly { value: string }[] };
      }
    ).opts.options.map((option) => option.value);
    expect(options).toEqual(['both', 'conversation', 'code', 'cancel']);

    const output = stripSgr(picker.render(120).join('\n'));
    expect(output).toContain('2 files');
    expect(output).toContain('7 insertions');
    expect(output).toContain('3 deletions');
    expect(output).toContain('Shell commands and manual edits are not tracked.');
  });

  it('refuses an incomplete checkpoint before offering restore actions', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-incomplete',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'unsafe edit',
          complete: false,
          changedPaths: ['src/a.ts'],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-incomplete',
        complete: false,
        paths: [{ path: 'src/a.ts', insertions: 1, deletions: 1, modeChanged: false }],
        insertions: 1,
        deletions: 1,
        conversationAvailable: true,
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('unsafe edit');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Error: Cannot restore code because this checkpoint is incomplete.',
      );
    });
    expect(session.restoreFileCheckpoint).not.toHaveBeenCalled();
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
  });

  it('reports checkpoint preview failures without claiming success', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-missing',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'missing',
          complete: true,
          changedPaths: [],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => {
        throw new Error('checkpoint not found');
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('missing');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain(
        'Error: Failed to preview checkpoint: checkpoint not found',
      );
      expect(transcript).not.toContain('Files restored');
    });
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
  });

  it('reports code restore failures without undoing the conversation', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-restore-fails',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'change files',
          complete: true,
          changedPaths: ['src/a.ts'],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-restore-fails',
        complete: true,
        paths: [{ path: 'src/a.ts', insertions: 1, deletions: 0, modeChanged: false }],
        insertions: 1,
        deletions: 0,
        conversationAvailable: true,
      })),
      restoreFileCheckpoint: vi.fn(async () => {
        throw new Error('disk write failed');
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('change files');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });

    const picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.handleInput('\u001B[B');
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Error: Failed to restore code: disk write failed');
      expect(transcript).not.toContain('Files restored');
    });
    expect(session.undoHistory).not.toHaveBeenCalled();
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
  });

  it('reports the recovery checkpoint when conversation undo fails after code restore', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-mixed',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'change files',
          complete: true,
          changedPaths: ['src/a.ts'],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-mixed',
        complete: true,
        paths: [{ path: 'src/a.ts', insertions: 1, deletions: 0, modeChanged: false }],
        insertions: 1,
        deletions: 0,
        conversationAvailable: true,
      })),
      restoreFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-mixed',
        recoveryCheckpointId: 'recovery-mixed',
        restoredPaths: ['src/a.ts'],
        deletedPaths: [],
      })),
      undoHistory: vi.fn(async () => {
        throw new Error('conversation rpc failed');
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('change files');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });
    (driver.state.editorContainer.children[0] as ChoicePickerComponent).handleInput('\r');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Error: Files were restored, but conversation undo failed. Recovery checkpoint: recovery-mixed.',
      );
    });
    expect(session.restoreFileCheckpoint).toHaveBeenCalledBefore(session.undoHistory);
    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({ kind: 'user', content: 'change files' }),
    ]);
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
  });

  it('reports successful code-only restores with counts and a recovery checkpoint', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-code',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'change files',
          complete: true,
          changedPaths: ['src/a.ts', 'src/new.ts'],
        },
      ]),
      previewFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-code',
        complete: true,
        paths: [
          { path: 'src/a.ts', insertions: 1, deletions: 0, modeChanged: false },
          { path: 'src/new.ts', insertions: 1, deletions: 0, modeChanged: false },
        ],
        insertions: 2,
        deletions: 0,
        conversationAvailable: true,
      })),
      restoreFileCheckpoint: vi.fn(async () => ({
        checkpointId: 'checkpoint-code',
        recoveryCheckpointId: 'recovery-code',
        restoredPaths: ['src/a.ts'],
        deletedPaths: ['src/new.ts'],
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('change files');
    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });

    const picker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    picker.handleInput('\u001B[B');
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Files restored');
      expect(transcript).toContain('Restored: 1. Deleted: 1.');
      expect(transcript).toContain('Recovery checkpoint: recovery-code.');
    });
    expect(session.undoHistory).not.toHaveBeenCalled();
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
  });

  it('rejects invalid undo counts without changing context', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('hello');
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo 0');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Error: Usage: /undo [count], where count is a positive integer.',
      );
    });

    expect(session.undoHistory).not.toHaveBeenCalled();
    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: 'hello',
      }),
    ]);
  });

  it('undoes from the real user turn when the last skill activation came from the model', async () => {
    const { driver } = await makeDriver();

    driver.handleUserInput('hello');
    driver.sessionEventHandler.handleEvent(
      {
        type: 'skill.activated',
        agentId: 'main',
        activationId: 'act-model',
        skillName: 'review',
        trigger: 'model-tool',
      } as Event,
      () => {},
    );
    driver.state.appState.streamingPhase = 'idle';

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(driver.state.transcriptEntries).toEqual([]);
    });

    expect(driver.state.transcriptEntries).toEqual([]);
    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('hello');
    expect(transcript).not.toContain('review');
  });

  it('keeps user-slash skill activations as undo anchors', async () => {
    const session = makeSession({
      listFileCheckpoints: vi.fn(async () => [
        {
          id: 'checkpoint-user',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:00:00.000Z',
          prompt: 'hello',
          complete: true,
          changedPaths: [],
        },
        {
          id: 'checkpoint-skill',
          kind: 'user' as const,
          createdAt: '2026-07-30T12:01:00.000Z',
          prompt: '/review',
          complete: true,
          changedPaths: [],
        },
      ]),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('hello');
    driver.sessionEventHandler.handleEvent(
      {
        type: 'skill.activated',
        agentId: 'main',
        activationId: 'act-user',
        skillName: 'review',
        trigger: 'user-slash',
        checkpointId: 'checkpoint-skill',
      } as Event,
      () => {},
    );
    driver.state.appState.streamingPhase = 'idle';

    expect(driver.state.transcriptEntries.at(-1)).toMatchObject({
      kind: 'skill_activation',
      checkpointId: 'checkpoint-skill',
    });

    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);

    await vi.waitFor(() => {
      expect(driver.state.transcriptEntries).toEqual([
        expect.objectContaining({
          kind: 'user',
          content: 'hello',
        }),
      ]);
    });

    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: 'hello',
      }),
    ]);
    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('hello');
    expect(transcript).not.toContain('review');
  });

  it('sends pasted image placeholders as image content parts', async () => {
    const { driver, session } = await makeDriver();
    const imageStore = (driver as unknown as { imageStore: ImageAttachmentStore }).imageStore;
    const attachment = imageStore.addImage(new Uint8Array([0xaa, 0xbb]), 'image/png', 1, 1);

    driver.handleUserInput(`describe ${attachment.placeholder}`);

    expect(session.prompt).toHaveBeenCalledWith([
      { type: 'text', text: 'describe ' },
      { type: 'image_url', imageUrl: { url: 'data:image/png;base64,qrs=' } },
    ]);
    expect(driver.state.transcriptEntries).toEqual([
      expect.objectContaining({
        kind: 'user',
        content: `describe ${attachment.placeholder}`,
        imageAttachmentIds: [attachment.id],
      }),
    ]);
  });

  it('queues editor input instead of prompting while a turn is already streaming', async () => {
    const { driver, session, harness } = await makeDriver();
    driver.state.appState.streamingPhase = 'waiting';
    harness.track.mockClear();

    driver.handleUserInput('queued message');

    expect(session.prompt).not.toHaveBeenCalled();
    expect(driver.state.queuedMessages).toEqual([{ text: 'queued message', agentId: 'main' }]);
    expect(driver.state.queueContainer.children.length).toBeGreaterThan(0);
    expect(harness.track).toHaveBeenCalledWith('input_queue', undefined);
  });

  it('cancels active streaming from Escape and Ctrl-C editor shortcuts', async () => {
    const { driver, session } = await makeDriver();

    driver.state.appState.streamingPhase = 'waiting';
    driver.state.editor.setText('draft while streaming');
    driver.state.editor.onEscape?.();

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(driver.state.editor.getText()).toBe('draft while streaming');

    session.cancel.mockClear();
    driver.state.appState.streamingPhase = 'waiting';
    driver.state.editor.setText('');
    driver.state.editor.onCtrlC?.();

    expect(session.cancel).toHaveBeenCalledTimes(1);
  });

  it('clears streaming editor text before cancelling the active turn on Ctrl-C', async () => {
    const { driver, session } = await makeDriver();

    driver.state.appState.streamingPhase = 'waiting';
    driver.state.editor.setText('draft while streaming');

    driver.state.editor.onCtrlC?.();

    expect(driver.state.editor.getText()).toBe('');
    expect(session.cancel).not.toHaveBeenCalled();
    expect(driver.state.appState.streamingPhase).toBe('waiting');

    driver.state.editor.onCtrlC?.();

    expect(session.cancel).toHaveBeenCalledTimes(1);
  });

  it('dispatches the next queued message after the active turn ends', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = await makeDriver();
      const sendQueued = vi.fn();
      driver.state.appState.streamingPhase = 'waiting';
      driver.state.appState.streamingStartTime = 1;
      driver.streamingUI.setTurnId('1');
      driver.state.queuedMessages = [{ text: 'next' }];

      driver.sessionEventHandler.handleEvent(
        {
          type: 'turn.ended',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          reason: 'completed',
        } as Event,
        sendQueued,
      );
      await vi.runOnlyPendingTimersAsync();

      expect(sendQueued).toHaveBeenCalledWith({ text: 'next' });
      expect(driver.state.queuedMessages).toEqual([]);
      expect(driver.state.appState.streamingPhase).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders cron fired events as distinct transcript entries', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'cron.fired',
        agentId: 'main',
        sessionId: 'ses-1',
        origin: {
          kind: 'cron_job',
          jobId: 'deadbeef',
          cron: '* * * * *',
          recurring: true,
          coalescedCount: 1,
          stale: false,
        },
        prompt: 'Remind the user: this is a once-per-minute reminder',
      } as Event,
      vi.fn(),
    );

    const entry = driver.state.transcriptEntries.at(-1);
    expect(entry).toMatchObject({
      kind: 'cron',
      content: 'Remind the user: this is a once-per-minute reminder',
      cronData: {
        jobId: 'deadbeef',
        cron: '* * * * *',
        coalescedCount: 1,
        stale: false,
      },
    });

    const transcript = stripSgr(driver.state.transcriptContainer.render(120).join('\n'));
    expect(transcript).toContain('Scheduled reminder fired');
    expect(transcript).toContain('* * * * *');
    expect(transcript).toContain('Remind the user: this is a once-per-minute reminder');
    expect(transcript).not.toContain('<cron-fire');
  });

  it('coalesces assistant delta component updates', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = await makeDriver();
      vi.mocked(driver.state.ui.requestRender).mockClear();

      driver.sessionEventHandler.handleEvent(
        {
          type: 'assistant.delta',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          delta: 'a',
        } as Event,
        vi.fn(),
      );
      const component = driver.streamingUI.getStreamingBlockComponent();
      if (component === undefined) throw new Error('expected streaming component');
      const updateSpy = vi.spyOn(component, 'updateContent');

      driver.sessionEventHandler.handleEvent(
        {
          type: 'assistant.delta',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          delta: 'b',
        } as Event,
        vi.fn(),
      );
      driver.sessionEventHandler.handleEvent(
        {
          type: 'assistant.delta',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          delta: 'c',
        } as Event,
        vi.fn(),
      );

      expect(updateSpy).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenLastCalledWith('abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes pending assistant deltas before turn completion', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = await makeDriver();
      const sendQueued = vi.fn();
      driver.state.appState.streamingPhase = 'waiting';

      driver.sessionEventHandler.handleEvent(
        {
          type: 'assistant.delta',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          delta: 'done',
        } as Event,
        sendQueued,
      );
      driver.sessionEventHandler.handleEvent(
        {
          type: 'turn.ended',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          reason: 'completed',
        } as Event,
        sendQueued,
      );

      expect(stripSgr(renderTranscript(driver))).toContain('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces streaming tool-call argument preview updates', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = await makeDriver();
      driver.streamingUI.setTurnId('1');
      driver.streamingUI.setStep(1);

      driver.sessionEventHandler.handleEvent(
        {
          type: 'tool.call.delta',
          agentId: 'main',
          sessionId: 'ses-1',
          turnId: 1,
          toolCallId: 'call_bash',
          name: 'Bash',
          argumentsPart: '{"command":"echo hi"}',
        } as Event,
        vi.fn(),
      );

      expect(driver.streamingUI.getToolComponent('call_bash')).toBeUndefined();
      expect(driver.streamingUI.hasActiveToolCall('call_bash')).toBe(false);

      await vi.runOnlyPendingTimersAsync();

      expect(driver.streamingUI.getToolComponent('call_bash')).toBeDefined();
      expect(driver.streamingUI.getActiveToolCall('call_bash')?.args).toMatchObject({
        command: 'echo hi',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels manual compaction from the editor', async () => {
    const { driver, session } = await makeDriver();
    driver.sessionEventHandler.handleEvent(
      {
        type: 'compaction.started',
        agentId: 'main',
        sessionId: 'ses-1',
        trigger: 'manual',
      } as Event,
      vi.fn(),
    );

    driver.state.editor.onEscape?.();

    expect(session.cancelCompaction).toHaveBeenCalledTimes(1);

    session.cancelCompaction.mockClear();
    driver.state.appState.isCompacting = true;
    driver.state.editor.onCtrlC?.();

    expect(session.cancelCompaction).toHaveBeenCalledTimes(1);
  });

  it('dismisses a running /btw panel before cancelling compaction on Escape', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);
    driver.state.appState.isCompacting = true;

    driver.state.editor.onEscape?.();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(session.cancelCompaction).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
  });

  it('cancels a running /btw question before cancelling compaction on Ctrl-C', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);
    driver.state.appState.isCompacting = true;

    driver.state.editor.onCtrlC?.();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(session.cancelCompaction).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(2);
  });

  it('dispatches the next queued message after compaction is cancelled', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = await makeDriver();
      const sendQueued = vi.fn();
      driver.sessionEventHandler.handleEvent(
        {
          type: 'compaction.started',
          agentId: 'main',
          sessionId: 'ses-1',
          trigger: 'manual',
        } as Event,
        sendQueued,
      );
      driver.state.queuedMessages = [{ text: 'next' }];

      driver.sessionEventHandler.handleEvent(
        {
          type: 'compaction.cancelled',
          agentId: 'main',
          sessionId: 'ses-1',
        } as Event,
        sendQueued,
      );
      await vi.runOnlyPendingTimersAsync();

      expect(driver.state.appState.isCompacting).toBe(false);
      expect(driver.state.appState.streamingPhase).toBe('idle');
      expect(driver.state.queuedMessages).toEqual([]);
      expect(sendQueued).toHaveBeenCalledWith({ text: 'next' });
      expect(driver.state.transcriptContainer.render(120).map(stripSgr).join('\n')).toContain(
        'Compaction cancelled',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders an error instead of prompting when no model is selected', async () => {
    const { driver, session } = await makeDriver();
    driver.state.appState.model = '';

    driver.handleUserInput('hello');

    expect(session.prompt).not.toHaveBeenCalled();
    expect(driver.state.transcriptContainer.render(120).join('\n')).toContain('LLM not set');
  });

  it('dispatches /init to the active session and clears busy state after completion', async () => {
    let resolveInit: (() => void) | undefined;
    const session = makeSession({
      init: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          }),
      ),
    });
    const { driver, harness } = await makeDriver(session);
    harness.track.mockClear();

    driver.handleUserInput('/init');

    await vi.waitFor(() => {
      expect(session.init).toHaveBeenCalledTimes(1);
    });
    expect(session.prompt).not.toHaveBeenCalled();
    expect(driver.state.appState.streamingPhase).not.toBe('idle');
    expect(driver.state.livePane.mode).toBe('waiting');

    resolveInit?.();

    await vi.waitFor(() => {
      expect(driver.state.appState.streamingPhase).toBe('idle');
    });
    expect(driver.state.livePane.mode).toBe('idle');
    expect(harness.track).toHaveBeenCalledWith('init_complete', undefined);
  });

  it('starts /btw through a forked side agent without changing the main busy state', async () => {
    const session = makeSession();
    const { driver, harness } = await makeDriver(session);
    harness.track.mockClear();
    driver.state.appState.streamingPhase = 'composing';
    driver.state.livePane.mode = 'thinking';

    driver.handleUserInput('/btw What are you working on right now?');

    await vi.waitFor(() => {
      expect(session.startBtw).toHaveBeenCalledWith();
    });
    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith('What are you working on right now?');
    });
    expect(session.steer).not.toHaveBeenCalled();
    expect(driver.state.appState.streamingPhase).toBe('composing');
    expect(driver.state.livePane.mode).toBe('thinking');
    expect(harness.track).toHaveBeenCalledWith('input_command', { command: 'btw' });
  });

  it('opens /btw without a question and sends the first panel input to a side agent', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/btw');

    await vi.waitFor(() => {
      expect(session.startBtw).toHaveBeenCalledWith();
    });
    expect(session.prompt).not.toHaveBeenCalled();
    expect(stripSgr(renderBtwPanel(driver))).toContain('Ready for a side question...');

    driver.handleUserInput('What are you working on right now?');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith('What are you working on right now?');
    });
    expect(session.steer).not.toHaveBeenCalled();
    expect(stripSgr(renderBtwPanel(driver))).toContain('Q: What are you working on right now?');
  });

  it('cancels an unused /btw side agent when closing an empty panel', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/btw');

    await vi.waitFor(() => {
      expect(session.startBtw).toHaveBeenCalledWith();
    });
    driver.state.editor.onEscape?.();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
  });

  it('renders /btw output in a dedicated panel instead of an Agent tool card', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session, 'What are you working on right now?');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'I am implementing the dedicated /btw panel.',
      } as Event,
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    expect(driver.state.btwPanelContainer.children).toHaveLength(2);
    expect(driver.state.btwPanelContainer.render(120)[0]?.trim()).toBe('');
    expect(getMountedBtwPanel(driver).isRunning()).toBe(false);
    expect(driver.state.editor.focused).toBe(true);

    const transcript = stripSgr(renderTranscript(driver));
    const panel = stripSgr(renderBtwPanel(driver));
    const editorLine = stripSgr(driver.state.editor.render(80)[1] ?? '');
    expect(panel).toContain('BTW ─ Esc close');
    expect(panel).not.toContain('ctrl+o expand');
    expect(editorLine.slice(0, 2)).toBe('❯ ');

    driver.state.editor.handleInput('/');
    const highlightedEditorLine = stripSgr(driver.state.editor.render(80)[1] ?? '');
    expect(highlightedEditorLine.slice(0, 2)).toBe('❯ ');
    expect(panel).not.toContain('BTW done');
    expect(panel).not.toContain('BTW running');
    expect(panel).not.toContain('BTW failed');
    expect(panel).not.toContain('Ask:');
    expect(panel).not.toContain('Type follow-up');
    expect(panel).toContain('Q: What are you working on right now?');
    expect(panel).toContain('I am implementing the dedicated /btw panel.');
    expect(panel).not.toContain('Agent');
    expect(transcript).not.toContain('BTW');
    expect(transcript).not.toContain('Esc close');
    expect(transcript).not.toContain('I am implementing the dedicated /btw panel.');
  });

  it('keeps the /btw panel above MCP status, the status bar, and the input', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'side answer',
      } as Event,
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        origin: { kind: 'user' },
      } as Event,
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        delta: 'main answer after btw',
      } as Event,
      () => {},
    );
    driver.streamingUI.flushNow();

    const transcript = stripSgr(renderTranscript(driver));
    const panel = stripSgr(renderBtwPanel(driver));
    const rootChildren = driver.state.ui.children;
    expect(rootChildren.indexOf(driver.state.btwPanelContainer)).toBe(
      rootChildren.indexOf(driver.state.mcpStatusContainer) - 1,
    );
    expect(rootChildren.indexOf(driver.state.mcpStatusContainer)).toBe(
      rootChildren.indexOf(driver.state.editorContainer) - 1,
    );
    expect(rootChildren.indexOf(driver.state.editorContainer)).toBe(
      rootChildren.indexOf(driver.state.statusBarContainer) - 1,
    );
    expect(transcript).toContain('main answer after btw');
    expect(transcript).not.toContain('side answer');
    expect(panel).toContain('BTW');
    expect(panel).not.toContain('BTW done');
    expect(panel).not.toContain('BTW running');
    expect(panel).not.toContain('BTW failed');
    expect(panel).toContain('side answer');
    expect(panel).not.toContain('main answer after btw');
  });

  it('renders only the tail of /btw thinking output', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n'),
      } as Event,
      () => {},
    );

    const transcript = stripSgr(renderTranscript(driver));
    const panel = stripSgr(renderBtwPanel(driver));
    expect(transcript).not.toContain('line7');
    expect(panel).not.toContain('line1');
    expect(panel).not.toContain('line5');
    expect(panel).toContain('line6');
    expect(panel).toContain('line7');
  });

  it('renders Markdown in the last two wrapped /btw thinking rows', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);
    const segments = Array.from({ length: 30 }, (_, index) =>
      `seg${String(index).padStart(2, '0')}`
    );

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: `**start** ${segments.join(' ')} **finish**`,
      } as Event,
      () => {},
    );

    const lines = getMountedBtwPanel(driver).render(36).map(stripSgr);
    const thinkingRows = lines.filter((line) => /seg\d\d/.test(line));
    const output = lines.join('\n');
    expect(thinkingRows).toHaveLength(2);
    expect(output).toContain('seg29');
    expect(output).toContain('finish');
    expect(output).not.toContain('seg00');
    expect(output).not.toContain('**');
  });

  it('renders /btw body at its actual content height when under the cap', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    const lines = getMountedBtwPanel(driver).render(80).map(stripSgr);
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).toContain('Q: side question');
    expect(lines.join('\n')).toContain('Waiting for answer...');
  });

  it('keeps /btw panel height stable when final output is shorter than thinking', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'thinking line 1\nthinking line 2',
      } as Event,
      () => {},
    );

    const mountedPanel = getMountedBtwPanel(driver);
    const thinkingLines = mountedPanel.render(80).map(stripSgr);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'final answer',
      } as Event,
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    const finalLines = mountedPanel.render(80).map(stripSgr);
    expect(finalLines).toHaveLength(thinkingLines.length);
    expect(finalLines.join('\n')).toContain('final answer');
    expect(finalLines.at(-1)).toMatch(/^│\s+│$/);
  });

  it('caps /btw height to one-third of the terminal and supports scrolling', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    setTerminalRows(driver, 15);
    await openBtwPanel(driver, session, 'question 1');

    const panel = getMountedBtwPanel(driver);
    panel.appendAnswer('answer 1');
    panel.markDone();
    for (let i = 2; i <= 8; i++) {
      panel.submit(`question ${String(i)}`);
      panel.appendAnswer(`answer ${String(i)}`);
      panel.markDone();
    }

    const collapsed = panel.render(80).map(stripSgr);
    expect(collapsed).toHaveLength(5);
    expect(collapsed.join('\n')).toContain('BTW ─ Esc close · ↑↓ scroll');
    expect(collapsed.join('\n')).not.toContain('ctrl+o expand');
    expect(collapsed.join('\n')).toContain('question 8');
    expect(collapsed.join('\n')).toContain('answer 8');
    expect(collapsed.join('\n')).not.toContain('question 1');

    driver.state.editor.setText('draft main input');
    const collapsedWithInput = panel.render(80).map(stripSgr);
    expect(collapsedWithInput.join('\n')).toContain('BTW ─ Esc close');
    expect(collapsedWithInput.join('\n')).not.toContain('↑↓ scroll');
    driver.state.editor.setText('');

    const requestRender = vi.mocked(driver.state.ui.requestRender);
    requestRender.mockClear();
    for (let i = 0; i < 20; i++) {
      driver.state.editor.handleInput('\u001B[A');
    }
    const scrolledUp = panel.render(80).map(stripSgr);
    expect(requestRender).toHaveBeenCalled();
    expect(scrolledUp.join('\n')).toContain('question 1');
    expect(scrolledUp.join('\n')).not.toContain('answer 8');

    panel.appendAnswer('\nstreamed tail while scrolled');
    expect(panel.render(80).map(stripSgr)).toEqual(scrolledUp);

    requestRender.mockClear();
    for (let i = 0; i < 20; i++) {
      driver.state.editor.handleInput('\u001B[B');
    }
    const scrolledDown = panel.render(80).map(stripSgr);
    expect(requestRender).toHaveBeenCalled();
    expect(scrolledDown.join('\n')).toContain('question 8');
    expect(scrolledDown.join('\n')).toContain('answer 8');
    expect(scrolledDown.join('\n')).toContain('streamed tail while scrolled');

    setTerminalRows(driver, 4);
    const tiny = panel.render(80).map(stripSgr);
    expect(tiny).toHaveLength(3);
    expect(tiny.join('\n')).not.toContain('ctrl+o expand');
    expect(tiny.join('\n')).toContain('answer 8');

    requestRender.mockClear();
    driver.state.editor.onToggleToolExpand?.();
    expect(driver.state.toolOutputExpanded).toBe(true);
    expect(panel.render(80).map(stripSgr)).toEqual(tiny);
  });

  it('cancels and closes a running /btw panel on Escape', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    const panel = getMountedBtwPanel(driver);
    expect(panel.isRunning()).toBe(true);
    expect(driver.state.editor.focused).toBe(true);

    const requestRender = vi.mocked(driver.state.ui.requestRender);
    requestRender.mockClear();
    driver.state.editor.onEscape?.();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
    expect(requestRender.mock.calls.at(-1)).toEqual([true]);
    const editorLine = stripSgr(driver.state.editor.render(80)[1] ?? '');
    expect(editorLine.slice(0, 2)).toBe('❯ ');
    expect(driver.state.editor.focused).toBe(true);
  });

  it('cancels a running /btw panel on Ctrl-C without closing it or cancelling main streaming', async () => {
    const session = makeSession();
    const { driver, harness } = await makeDriver(session);
    const cancelledAgentIds: string[] = [];
    session.cancel.mockImplementation(async () => {
      cancelledAgentIds.push(harness.interactiveAgentId);
    });
    await openBtwPanel(driver, session);
    driver.state.appState.streamingPhase = 'waiting';
    driver.state.editor.setText('draft main input');

    const panel = getMountedBtwPanel(driver);
    expect(panel.isRunning()).toBe(true);

    driver.state.editor.onCtrlC?.();

    expect(session.cancel).toHaveBeenCalledOnce();
    expect(cancelledAgentIds).toEqual(['agent-btw']);
    expect(getMountedBtwPanel(driver)).toBe(panel);
    expect(driver.state.btwPanelContainer.children).toHaveLength(2);
    expect(driver.state.editor.focused).toBe(true);
    expect(driver.state.editor.getText()).toBe('draft main input');
    expect(driver.state.appState.streamingPhase).toBe('waiting');
  });

  it('preserves rendered /btw output when a running panel is cancelled', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);
    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'partial side answer',
      } as Event,
      () => {},
    );

    driver.state.editor.onCtrlC?.();
    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'cancelled',
      } as Event,
      () => {},
    );

    const panel = stripSgr(renderBtwPanel(driver));
    expect(panel).toContain('partial side answer');
    expect(panel).toContain('Interrupted by user');
  });

  it('cancels a running /btw panel when starting a new session clears it', async () => {
    const initialSession = makeSession({ id: 'ses-initial' });
    const nextSession = makeSession({ id: 'ses-next' });
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(initialSession)
      .mockResolvedValueOnce(nextSession);
    const { driver, harness } = await makeDriver(initialSession, { createSession });
    const cancelledAgentIds: string[] = [];
    initialSession.cancel.mockImplementation(async () => {
      cancelledAgentIds.push(harness.interactiveAgentId);
    });
    await openBtwPanel(driver, initialSession);

    driver.handleUserInput('/new');

    await vi.waitFor(() => {
      expect(driver.getCurrentSessionId()).toBe('ses-next');
    });
    expect(initialSession.cancel).toHaveBeenCalledOnce();
    expect(cancelledAgentIds).toEqual(['agent-btw']);
    expect(nextSession.cancel).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
  });

  it('closes a completed /btw panel on Ctrl-C without cancelling main streaming', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );
    driver.state.appState.streamingPhase = 'waiting';
    driver.state.editor.setText('draft main input');

    expect(getMountedBtwPanel(driver).isRunning()).toBe(false);

    driver.state.editor.onCtrlC?.();

    expect(session.cancel).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
    expect(driver.state.editor.focused).toBe(true);
    expect(driver.state.editor.getText()).toBe('draft main input');
    expect(driver.state.appState.streamingPhase).toBe('waiting');
  });

  it('closes a completed /btw panel on Escape without cancelling it', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    const panel = getMountedBtwPanel(driver);
    expect(panel.isRunning()).toBe(false);
    expect(driver.state.editor.focused).toBe(true);

    driver.state.editor.onEscape?.();

    expect(session.cancel).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
    expect(driver.state.editor.focused).toBe(true);
  });

  it('sends follow-up /btw input through ordinary prompt on the same side agent', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session, 'first question');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    const panel = getMountedBtwPanel(driver);
    expect(panel.isRunning()).toBe(false);
    driver.handleUserInput('follow up');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith('follow up');
    });
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(driver.state.btwPanelContainer.children).toHaveLength(2);
    expect(driver.state.editor.focused).toBe(true);
  });

  it('keeps main input pointed at /btw while the panel is open', async () => {
    let resolveBtwPrompt: (() => void) | undefined;
    const session = makeSession({
      prompt: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveBtwPrompt = resolve;
          }),
      ),
    });
    const { driver, harness } = await makeDriver(session);

    await openBtwPanel(driver, session, 'slow side question');

    expect(harness.interactiveAgentId).toBe('main');
    driver.handleUserInput('follow-up while btw prompt is pending');
    driver.handleUserInput('another follow-up while btw prompt is pending');

    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(driver.state.queuedMessages).toEqual([]);
    expect(driver.state.editor.getText()).toBe('another follow-up while btw prompt is pending');
    expect(stripSgr(renderTranscript(driver))).not.toContain(
      'Wait for /btw to finish before sending another question.',
    );
    expect(
      countOccurrences(
        stripSgr(renderBtwPanel(driver)),
        'Wait for /btw to finish before sending another question.',
      ),
    ).toBe(2);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'agent-btw',
        sessionId: 'ses-1',
        turnId: 0,
        reason: 'completed',
      } as Event,
      () => {},
    );

    expect(stripSgr(renderBtwPanel(driver))).not.toContain(
      'Wait for /btw to finish before sending another question.',
    );

    resolveBtwPrompt?.();
  });

  it('replaces a running /btw panel when another /btw command is submitted', async () => {
    const session = makeSession({
      startBtw: vi.fn()
        .mockResolvedValueOnce('agent-btw-1')
        .mockResolvedValueOnce('agent-btw-2'),
    });
    const { driver } = await makeDriver(session);
    await openBtwPanel(driver, session, 'first question');

    const firstPanel = getMountedBtwPanel(driver);
    expect(firstPanel.isRunning()).toBe(true);

    driver.handleUserInput('/btw second question');

    await vi.waitFor(() => {
      expect(session.startBtw).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith('second question');
    });

    const secondPanel = getMountedBtwPanel(driver);
    expect(secondPanel).not.toBe(firstPanel);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(2);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw-1',
        sessionId: 'ses-1',
        turnId: 0,
        delta: 'answer from old side agent',
      } as Event,
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'agent-btw-2',
        sessionId: 'ses-1',
        turnId: 1,
        delta: 'answer from new side agent',
      } as Event,
      () => {},
    );

    const renderedPanel = stripSgr(renderBtwPanel(driver));
    expect(renderedPanel).not.toContain('answer from old side agent');
    expect(renderedPanel).toContain('answer from new side agent');
  });

  it('does not run /btw without a selected model', async () => {
    const { driver, session } = await makeDriver();

    driver.state.appState.model = '';
    driver.handleUserInput('/btw');
    expect(session.startBtw).not.toHaveBeenCalled();
    expect(driver.state.btwPanelContainer.children).toHaveLength(0);
    expect(stripSgr(renderTranscript(driver))).toContain('LLM not set');

    driver.handleUserInput('/btw What are you doing now?');

    expect(session.startBtw).not.toHaveBeenCalled();
    expect(stripSgr(renderTranscript(driver))).toContain('LLM not set');
  });

  it('renders Dynamic Workflow markers from /workflow commands, not tool-triggered status updates', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'agent.status.updated',
        agentId: 'main',
        sessionId: 'ses-1',
        dynamicWorkflowMode: true,
      } as Event,
      vi.fn(),
    );

    expect(driver.state.appState.dynamicWorkflowMode).toBe(true);
    expect(stripSgr(renderTranscript(driver))).not.toContain('Dynamic Workflow activated');

    let transcript = stripSgr(renderTranscript(driver));
    expect(countOccurrences(transcript, 'Dynamic Workflow activated')).toBe(0);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'agent.status.updated',
        agentId: 'main',
        sessionId: 'ses-1',
        dynamicWorkflowMode: false,
      } as Event,
      vi.fn(),
    );

    expect(driver.state.appState.dynamicWorkflowMode).toBe(false);
    transcript = stripSgr(renderTranscript(driver));
    expect(transcript).not.toContain('Dynamic Workflow deactivated');
    expect(transcript).not.toContain('Dynamic Workflow ended');

    expect(countOccurrences(transcript, 'Dynamic Workflow activated')).toBe(0);
    expect(countOccurrences(transcript, 'Dynamic Workflow deactivated')).toBe(0);
    expect(countOccurrences(transcript, 'Dynamic Workflow ended')).toBe(0);
  });

  it('renders an ended marker when a one-shot /workflow task exits', async () => {
    const { driver, session } = await makeDriver(undefined);
    driver.state.appState.permissionMode = 'auto';

    driver.handleUserInput('/workflow Ship feature X');

    await vi.waitFor(() => {
      expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    });
    await vi.waitFor(() => {
      expect(countOccurrences(stripSgr(renderTranscript(driver)), 'Dynamic Workflow activated')).toBe(1);
    });
    let transcript = stripSgr(renderTranscript(driver));
    expect(countOccurrences(transcript, 'Dynamic Workflow activated')).toBe(1);
    expect(transcript).not.toContain('Dynamic Workflow ended');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'agent.status.updated',
        agentId: 'main',
        sessionId: 'ses-1',
        dynamicWorkflowMode: false,
      } as Event,
      vi.fn(),
    );

    expect(driver.state.appState.dynamicWorkflowMode).toBe(false);
    transcript = stripSgr(renderTranscript(driver));
    expect(countOccurrences(transcript, 'Dynamic Workflow activated')).toBe(1);
    expect(countOccurrences(transcript, 'Dynamic Workflow ended')).toBe(1);
    expect(transcript).not.toContain('Dynamic Workflow deactivated');
  });

  it('queues Ctrl-S input instead of steering while /init is running', async () => {
    let resolveInit: (() => void) | undefined;
    const session = makeSession({
      init: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          }),
      ),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/init');
    await vi.waitFor(() => {
      expect(session.init).toHaveBeenCalledTimes(1);
    });

    driver.state.editor.setText('apply after init');
    driver.state.editor.onCtrlS?.();

    expect(session.steer).not.toHaveBeenCalled();
    expect(driver.state.queuedMessages).toEqual([{ text: 'apply after init', agentId: 'main' }]);
    expect(stripSgr(driver.state.queueContainer.render(120).join('\n'))).not.toContain(
      'ctrl-s to steer immediately',
    );

    resolveInit?.();

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith('apply after init');
    });
    expect(driver.state.queuedMessages).toEqual([]);
  });

  it('cancels the active /init request through the session', async () => {
    let resolveInit: (() => void) | undefined;
    const session = makeSession({
      init: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          }),
      ),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/init');
    await vi.waitFor(() => {
      expect(session.init).toHaveBeenCalledTimes(1);
    });

    driver.state.editor.onEscape?.();

    await vi.waitFor(() => {
      expect(session.cancel).toHaveBeenCalledTimes(1);
    });

    resolveInit?.();
  });

  it('does not run /init when no model is selected', async () => {
    const { driver, session } = await makeDriver();
    driver.state.appState.model = '';

    driver.handleUserInput('/init');

    expect(session.init).not.toHaveBeenCalled();
    expect(driver.state.transcriptContainer.render(120).join('\n')).toContain('LLM not set');
  });

  it('shows the login prompt for auth.login_required session errors', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'error',
        agentId: 'main',
        sessionId: 'ses-1',
        code: 'auth.login_required',
        message: 'OAuth provider credentials were rejected.',
        retryable: false,
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('OAuth login expired. Send /login to login.');
    expect(transcript).not.toContain('[auth.login_required]');
    expect(transcript).not.toContain('/export-debug-zip');
  });

  it('appends the /export-debug-zip hint beneath session error messages', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'error',
        agentId: 'main',
        sessionId: 'ses-1',
        code: 'compaction.failed',
        message: "APIStatusError: 400 the message at position 82 with role 'assistant' must not be empty",
        retryable: false,
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(driver.state.transcriptContainer.render(200).join('\n'));
    expect(transcript).toContain('Error: [compaction.failed]');
    expect(transcript).toContain('If this persists, run `/export-debug-zip`');
    expect(transcript).toContain("Please don't share it publicly");
    expect(transcript).not.toContain('pythinker export');
  });

  it('shows concise provider filter text for filtered session errors', async () => {
    const { driver } = await makeDriver();
    const verboseMessage =
      'The API returned a response containing only thinking content without any text or tool calls. ' +
      'This usually indicates the stream was interrupted or the output token budget was exhausted ' +
      'during reasoning. Provider stop details: finishReason=filtered, rawFinishReason=content_filter. ' +
      'The provider filtered the response before visible output was emitted. Provider: example-provider, model: example-model';

    driver.sessionEventHandler.handleEvent(
      {
        type: 'error',
        agentId: 'main',
        sessionId: 'ses-1',
        code: 'provider.api_error',
        message: verboseMessage,
        details: {
          finishReason: 'filtered',
          rawFinishReason: 'content_filter',
        },
        retryable: true,
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(driver.state.transcriptContainer.render(200).join('\n'));
    expect(transcript).toContain(
      'Error: [provider.api_error] Provider filtered the response before visible output',
    );
    expect(transcript).toContain('finishReason=filtered');
    expect(transcript).toContain('rawFinishReason=content_filter');
    expect(transcript).not.toContain('only thinking content');
    expect(transcript).not.toContain('token budget');
    expect(transcript).not.toContain('stream was interrupted');
  });

  it('skips the /export-debug-zip hint when no active session id is set', async () => {
    const { driver } = await makeDriver();
    driver.state.appState.sessionId = '';

    driver.sessionEventHandler.handleEvent(
      {
        type: 'error',
        agentId: 'main',
        sessionId: '',
        code: 'compaction.failed',
        message: 'boom',
        retryable: false,
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('Error: [compaction.failed]');
    expect(transcript).not.toContain('/export-debug-zip');
  });

  it('shows ExitPlanMode plan only in the current-plan card during approval', async () => {
    const planContent = '# No Duplicate Plan\n\n- Do the non-duplicated plan work';
    const session = makeSession({
      getPlan: vi.fn(async () => ({
        id: 'no-duplicate-plan',
        content: planContent,
        path: '/tmp/no-duplicate-plan.md',
      })),
    });
    const { driver } = await makeDriver(session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_exit_plan',
        name: 'ExitPlanMode',
        args: {},
      } as Event,
      vi.fn(),
    );

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Current plan');
      expect(countOccurrences(transcript, 'non-duplicated plan work')).toBe(1);
    });

    const approvalHandler = vi.mocked(session.setApprovalHandler).mock.calls[0]?.[0] as
      | ((request: ApprovalRequest) => Promise<ApprovalResponse>)
      | undefined;
    if (approvalHandler === undefined) throw new Error('expected approval handler');
    void approvalHandler({
      turnId: 1,
      toolCallId: 'call_exit_plan',
      toolName: 'ExitPlanMode',
      action: 'Review plan',
      display: {
        kind: 'plan_review',
        plan: planContent,
        path: '/tmp/no-duplicate-plan.md',
      },
    });

    await vi.waitFor(() => {
      const approval = stripSgr(driver.state.editorContainer.render(120).join('\n'));
      expect(approval).toContain('Ready to build with this plan?');
      expect(approval).not.toContain('non-duplicated plan work');
      expect(approval).not.toContain('/tmp/no-duplicate-plan.md');
    });
  });

  it('routes Dynamic Workflow mission control, drains early lifecycle events, and preserves index order', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_dynamic_workflow', name: 'DynamicWorkflow',
      args: { description: 'Review changed files', items: ['src/a.ts', 'src/b.ts'] },
    } as Event);
    expect(driver.state.footerState.activity.phase).toBe('hidden');
    expect(renderActivity(driver)).toBe('');
    dispatch({
      type: 'subagent.started', agentId: 'main', sessionId: 'ses-1', subagentId: 'agent-2',
      parentToolCallId: 'call_dynamic_workflow',
    } as Event);
    dispatch({
      type: 'subagent.completed', agentId: 'main', sessionId: 'ses-1', subagentId: 'agent-2',
      parentToolCallId: 'call_dynamic_workflow', resultSummary: 'Completed before spawn',
    } as Event);
    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1', parentToolCallId: 'call_dynamic_workflow',
      subagentId: 'agent-2', subagentName: 'coder', dynamicWorkflowIndex: 2, runInBackground: false,
    } as Event);
    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1', parentToolCallId: 'call_dynamic_workflow',
      subagentId: 'agent-1', subagentName: 'coder', dynamicWorkflowIndex: 1, runInBackground: false,
    } as Event);
    dispatch({ type: 'subagent.started', agentId: 'main', sessionId: 'ses-1', subagentId: 'agent-1' } as Event);
    dispatch({
      type: 'assistant.delta', agentId: 'agent-1', sessionId: 'ses-1', turnId: 2,
      delta: 'Reading src/a.ts',
    } as Event);
    dispatch({
      type: 'subagent.failed', agentId: 'main', sessionId: 'ses-1', subagentId: 'agent-2', error: 'Late failure',
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('Dynamic Workflow');
    // The running row advances through the approved progress-glyph frames.
    expect(transcript).toMatch(/001\s+[◐◓◑◒]\s+RUN\s+src\/a.ts/u);
    expect(transcript).toMatch(/002\s+✓\s+DONE\s+src\/b.ts/u);
    expect(transcript).toMatch(/Orchestrating\s+1\/2 complete/u);
    expect(transcript).not.toContain('━');
    expect(transcript).toContain('Completed before spawn');
    expect(transcript).not.toContain('Late failure');
    expect(driver.streamingUI.getToolComponent('call_dynamic_workflow')).toBeUndefined();
  });

  it('surfaces a workflow.warning on the live Dynamic Workflow mission control', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_warn_workflow', name: 'DynamicWorkflow',
      args: { description: 'Review changed files', items: ['src/a.ts', 'src/b.ts'] },
    } as Event);
    dispatch({
      type: 'workflow.warning', agentId: 'main', sessionId: 'ses-1',
      workflowRunId: 'run-1', parentToolCallId: 'call_warn_workflow',
      agentCount: 12, threshold: 8,
      message: 'This Dynamic Workflow will launch 12 subagents, above the advisory ceiling of 8; the run is proceeding anyway.',
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('Dynamic Workflow');
    expect(transcript).toContain('12 subagents');
    expect(transcript).toContain('advisory ceiling of 8');
  });

  it('falls back to the status line when a workflow.warning has no mission control', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const showStatus = vi
      .spyOn(driver as unknown as { showStatus: (message: string, color?: unknown) => void }, 'showStatus')
      .mockImplementation(() => {});
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'workflow.warning', agentId: 'main', sessionId: 'ses-1',
      workflowRunId: 'run-1', parentToolCallId: 'call_retired_workflow',
      agentCount: 12, threshold: 8,
      message: 'This Dynamic Workflow will launch 12 subagents, above the advisory ceiling of 8; the run is proceeding anyway.',
    } as Event);

    expect(showStatus).toHaveBeenCalledWith(
      'This Dynamic Workflow will launch 12 subagents, above the advisory ceiling of 8; the run is proceeding anyway.',
      'warning',
    );
  });

  it('mounts the framed workflow on the first named delta before the denominator is known', async () => {
    const { driver } = await makeDriver(makeSession(), {}, 'fixed');
    driver.state.editorContainer.addChild(driver.state.editor);
    driver.state.ui.setFocus(driver.state.editor);
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.delta', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_streaming_workflow', name: 'DynamicWorkflow',
      argumentsPart: '{"description":"Review changed files","items":["src/a.ts","src/b',
    } as Event);

    expect(driver.state.transcriptContainer.children.some(
      (child) => child instanceof DynamicWorkflowMissionControlComponent,
    )).toBe(true);
    expect(driver.state.editorContainer.children[0]).toBe(driver.state.editor);
    expect(driver.state.editor.focused).toBe(true);
    let transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('╭─ Dynamic Workflow');
    expect(transcript).toContain('Waiting for delegated agents');
    expect(transcript).not.toMatch(/Orchestrating[^\n]*\b\d+%/u);
    expect(transcript).not.toContain('━');
    expect(transcript).toContain('001');

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_streaming_workflow', name: 'DynamicWorkflow',
      args: { description: 'Review changed files', items: ['src/a.ts', 'src/b.ts'] },
    } as Event);

    transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('0/2 complete');
    expect(transcript).toMatch(/001\s+○\s+WAIT\s+src\/a.ts/u);
  });

  it('keeps terminal Dynamic Workflow results static and does not fabricate child failures', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_terminal_workflow', name: 'DynamicWorkflow',
      args: { description: 'Review changed files', items: ['src/a.ts', 'src/b.ts'] },
    } as Event);
    dispatch({
      type: 'tool.result', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_terminal_workflow', isError: false,
      output: [
        '<dynamic_workflow_result>',
        '<summary>completed: 1, failed: 1, aborted: 0</summary>',
        '<subagent index="1" outcome="completed">Imports are stable.</subagent>',
        '<subagent index="2" outcome="failed">Agent timed out after 30s.</subagent>',
        '</dynamic_workflow_result>',
      ].join('\n'),
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('✓ Completed');
    expect(transcript).toMatch(/001\s+✓\s+DONE\s+src\/a.ts/u);
    expect(transcript).toMatch(/002\s+×\s+FAIL\s+src\/b.ts/u);
    expect(transcript).toContain('Agent timed out after 30s.');
    expect(transcript).not.toContain('⠋ Orchestrating');
  });

  it.each(['turn cleanup', 'session runtime reset', 'session error cleanup'] as const)(
    'does not drain old-generation lifecycle at %s into a later workflow with the same agent id',
    async (cleanup) => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'subagent.completed', agentId: 'main', sessionId: 'ses-1', subagentId: 'reused-agent',
      parentToolCallId: 'call_old_workflow', resultSummary: 'must not leak',
    } as Event);
    if (cleanup === 'turn cleanup') {
      dispatch({ type: 'turn.started', agentId: 'main', sessionId: 'ses-1', turnId: 2 } as Event);
    } else if (cleanup === 'session runtime reset') {
      driver.sessionEventHandler.resetRuntimeState();
    } else {
      dispatch({
        type: 'error',
        agentId: 'main',
        sessionId: 'ses-1',
        code: 'provider.connection_error',
        message: 'Provider disconnected',
        retryable: false,
      } as Event);
    }
    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 2,
      toolCallId: 'call_cleanup_workflow', name: 'DynamicWorkflow',
      args: { description: 'Fresh workflow', items: ['src/fresh.ts'] },
    } as Event);
    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1', parentToolCallId: 'call_cleanup_workflow',
      subagentId: 'reused-agent', subagentName: 'coder', dynamicWorkflowIndex: 1, runInBackground: false,
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toMatch(/001\s+○\s+WAIT\s+src\/fresh.ts/u);
    expect(transcript).not.toContain('must not leak');
    },
  );

  it('keeps unrelated pending background lifecycle through /undo', async () => {
    const { driver, session } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    driver.handleUserInput('launch unrelated workflow');
    dispatch({
      type: 'subagent.completed', agentId: 'main', sessionId: 'ses-1', subagentId: 'background-1',
      parentToolCallId: 'call_background', resultSummary: 'Completed before spawn',
    } as Event);
    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_unrelated_workflow', name: 'DynamicWorkflow',
      args: { description: 'Unrelated workflow', items: ['src/a.ts'] },
    } as Event);

    driver.state.appState.streamingPhase = 'idle';
    driver.handleUserInput('/undo');
    await confirmUndoSelection(driver);
    await vi.waitFor(() => {
      expect(session.undoHistory).toHaveBeenCalledWith(1);
    });

    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1',
      subagentId: 'background-1', subagentName: 'researcher', parentToolCallId: 'call_background',
      description: 'Inspect the repository', runInBackground: true,
    } as Event);

    expect(stripSgr(renderTranscript(driver))).toContain('researcher agent completed in background');
  });

  it('keeps an early background completion buffered through Dynamic Workflow cancellation', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'subagent.completed', agentId: 'main', sessionId: 'ses-1', subagentId: 'background-cancelled',
      parentToolCallId: 'call_background', resultSummary: 'Completed before cancellation',
    } as Event);
    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_cancelled_workflow', name: 'DynamicWorkflow',
      args: { description: 'Cancelled workflow', items: ['src/cancelled.ts'] },
    } as Event);
    dispatch({
      type: 'turn.ended', agentId: 'main', sessionId: 'ses-1', turnId: 1, reason: 'cancelled',
    } as Event);
    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1',
      subagentId: 'background-cancelled', subagentName: 'researcher', parentToolCallId: 'call_background',
      description: 'Inspect the repository', runInBackground: true,
    } as Event);

    expect(stripSgr(renderTranscript(driver))).toContain('researcher agent completed in background');
  });

  it('keeps an early generic failure buffered across a result for a missing workflow control', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_missing_workflow', name: 'DynamicWorkflow',
      args: { description: 'Workflow removed before result', items: ['src/removed.ts'] },
    } as Event);
    driver.sessionEventHandler.clearDynamicWorkflowMissionControls();
    dispatch({
      type: 'subagent.failed', agentId: 'main', sessionId: 'ses-1', subagentId: 'generic-missing',
      parentToolCallId: 'call_followup_workflow', error: 'Early generic failure',
    } as Event);
    dispatch({
      type: 'tool.result', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_missing_workflow', isError: false, output: 'result after cleanup',
    } as Event);
    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_followup_workflow', name: 'DynamicWorkflow',
      args: { description: 'Follow-up workflow', items: ['src/generic.ts'] },
    } as Event);
    dispatch({
      type: 'subagent.spawned', agentId: 'main', sessionId: 'ses-1', parentToolCallId: 'call_followup_workflow',
      subagentId: 'generic-missing', subagentName: 'coder', dynamicWorkflowIndex: 1, runInBackground: false,
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toMatch(/001\s+×\s+FAIL\s+src\/generic.ts/u);
    expect(transcript).toContain('Early generic failure');
  });

  it('marks an errored structured workflow result failed while preserving child statuses', async () => {
    const { driver } = await makeDriver();
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_error_workflow', name: 'DynamicWorkflow',
      args: { description: 'Review changed files', items: ['src/a.ts'] },
    } as Event);
    dispatch({
      type: 'tool.result', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_error_workflow', isError: true,
      output: [
        '<dynamic_workflow_result>',
        '<subagent index="1" outcome="completed">Child completed before request error</subagent>',
        '</dynamic_workflow_result>',
      ].join('\n'),
    } as Event);

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('× Failed');
    expect(transcript).toMatch(/001\s+✓\s+DONE\s+src\/a.ts/u);
    expect(transcript).toContain('Child completed before request error');
  });

  it('subtracts later transcript rows from fixed Mission Control height', async () => {
    const { driver } = await makeDriver(makeSession(), {}, 'fixed');
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);
    setTerminalRows(driver, 10);
    setTerminalColumns(driver, 100);
    vi.spyOn(driver.state.layoutRoot, 'followingRows').mockReturnValue(2);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_fixed_workflow', name: 'DynamicWorkflow',
      args: { description: 'Fixed layout work', items: ['One', 'Two', 'Three', 'Four', 'Five'] },
    } as Event);
    const missionControl = driver.state.transcriptContainer.children.find(
      (child): child is DynamicWorkflowMissionControlComponent =>
        child instanceof DynamicWorkflowMissionControlComponent,
    );
    if (missionControl === undefined) throw new Error('expected Dynamic Workflow mission control');
    const followingTranscript: Component = {
      render: () => ['Later transcript row one', 'Later transcript row two', 'Later transcript row three'],
      invalidate: () => {},
    };
    driver.state.transcriptContainer.addChild(followingTranscript);

    const lines = missionControl.render(100);
    expect(lines).toHaveLength(5);
    expect(stripSgr(lines.slice(0, 2).join('\n'))).toContain('Dynamic Workflow');
    expect(stripSgr(lines.slice(0, 2).join('\n'))).toContain('Orchestrating');
  });

  it('keeps a cleaned-up fixed Mission Control bounded by later transcript siblings', async () => {
    const { driver } = await makeDriver(makeSession(), {}, 'fixed');
    const sendQueued = vi.fn();
    const dispatch = (event: Event): void => driver.sessionEventHandler.handleEvent(event, sendQueued);
    setTerminalRows(driver, 10);
    setTerminalColumns(driver, 100);
    vi.spyOn(driver.state.layoutRoot, 'followingRows').mockReturnValue(2);

    dispatch({
      type: 'tool.call.started', agentId: 'main', sessionId: 'ses-1', turnId: 1,
      toolCallId: 'call_cleaned_fixed_workflow', name: 'DynamicWorkflow',
      args: { description: 'Cleaned fixed layout work', items: ['One', 'Two', 'Three', 'Four', 'Five'] },
    } as Event);
    const missionControl = driver.state.transcriptContainer.children.find(
      (child): child is DynamicWorkflowMissionControlComponent =>
        child instanceof DynamicWorkflowMissionControlComponent,
    );
    if (missionControl === undefined) throw new Error('expected Dynamic Workflow mission control');

    driver.sessionEventHandler.clearDynamicWorkflowMissionControls();
    const followingTranscript: Component = {
      render: () => ['Later transcript row one', 'Later transcript row two', 'Later transcript row three'],
      invalidate: () => {},
    };
    driver.state.transcriptContainer.addChild(followingTranscript);

    const lines = missionControl.render(100);
    expect(driver.state.transcriptContainer.children).toContain(missionControl);
    expect(lines).toHaveLength(5);
    expect(stripSgr(lines[0] ?? '')).toContain('Dynamic Workflow');
    expect(stripSgr(lines[1] ?? '')).toContain('Cancelled');
  });

  it('shows plan review reject on the plan card without an approval notice', async () => {
    const planContent = '# Reject Plan\n\n- keep this plan visible after reject';
    const session = makeSession({
      getPlan: vi.fn(async () => ({
        id: 'reject-plan',
        content: planContent,
        path: '/tmp/reject-plan.md',
      })),
    });
    const { driver } = await makeDriver(session);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_exit_reject_plan',
        name: 'ExitPlanMode',
        args: {},
      } as Event,
      vi.fn(),
    );

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Reject Plan');
      expect(countOccurrences(transcript, 'keep this plan visible after reject')).toBe(1);
    });

    const approvalHandler = vi.mocked(session.setApprovalHandler).mock.calls[0]?.[0] as
      | ((request: ApprovalRequest) => Promise<ApprovalResponse>)
      | undefined;
    if (approvalHandler === undefined) throw new Error('expected approval handler');
    const response = approvalHandler({
      turnId: 1,
      toolCallId: 'call_exit_reject_plan',
      toolName: 'ExitPlanMode',
      action: 'Review plan',
      display: {
        kind: 'plan_review',
        plan: planContent,
        path: '/tmp/reject-plan.md',
      },
    });

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ApprovalPanelComponent);
    });
    (driver.state.editorContainer.children[0] as ApprovalPanelComponent).handleInput('2');
    await expect(response).resolves.toMatchObject({ decision: 'rejected' });

    driver.sessionEventHandler.handleEvent(
      {
        type: 'tool.result',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        toolCallId: 'call_exit_reject_plan',
        output: 'Plan rejected by user. Plan mode remains active.',
        isError: true,
      } as Event,
      vi.fn(),
    );

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('plan: reject-plan.md · Rejected');
      expect(transcript).toContain('Reject Plan');
      expect(countOccurrences(transcript, 'keep this plan visible after reject')).toBe(1);
      expect(transcript).not.toContain('Rejected: Review plan');
      expect(transcript).not.toContain('Plan rejected by user.');
      expect(transcript).not.toContain('Plan mode remains active.');
    });
  });

  it('renders /cost from the active model rates and accumulated session spend', async () => {
    const session = makeSession({
      getStatus: vi.fn(async () => ({
        model: 'k2',
        modelCostRates: { input: 3, output: 15, cacheRead: 0.3 },
        thinkingLevel: 'off',
        permission: 'manual',
        planMode: false,
        dynamicWorkflowMode: false,
        contextTokens: 0,
        maxContextTokens: 100,
        contextUsage: 0,
        usage: { totalCostUsd: 0.125 },
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/cost');

    await vi.waitFor(() => {
      const output = stripSgr(driver.state.transcriptContainer.render(120).join('\n'));
      expect(output).toContain(' Cost ');
      expect(output).toContain('Session spend');
      expect(output).toContain('$0.125');
      expect(output).toContain('Current model');
      expect(output).toContain('k2');
      expect(output).toContain('$3 / 1M tokens');
      expect(output).toContain('$15 / 1M tokens');
      expect(output).toContain('$0.3 / 1M tokens');
    });
  });

  it('renders /status using the active session runtime status', async () => {
    const session = makeSession({
      getStatus: vi.fn(async () => ({
        model: 'k2',
        thinkingLevel: 'high',
        permission: 'auto',
        planMode: true,
        contextTokens: 25,
        maxContextTokens: 100,
        contextUsage: 0.25,
      })),
    });
    const { driver } = await makeDriver(session);
    const getStatus = vi.mocked(session.getStatus);
    const previousStatusCalls = getStatus.mock.calls.length;

    driver.handleUserInput('/status');

    await vi.waitFor(() => {
      expect(getStatus).toHaveBeenCalledTimes(previousStatusCalls + 1);
      const output = stripSgr(driver.state.transcriptContainer.render(120).join('\n'));
      expect(output).toContain(' Status ');
      expect(output).toContain('>_ Pythinker');
      expect(output).toContain('Model');
      expect(output).toContain('thinking high');
      expect(output).toContain('Permissions  auto');
      expect(output).toContain('Plan mode    on');
      expect(output).toContain('Context window');
      expect(output).toContain('25%');
    });
  });

  it('renders /mcp using a fresh MCP server snapshot', async () => {
    const session = makeSession({
      listMcpServers: vi.fn(async () => [
        {
          name: 'local-tools',
          transport: 'stdio',
          status: 'connected',
          toolCount: 2,
        },
        {
          name: 'remote-tools',
          transport: 'http',
          status: 'failed',
          toolCount: 0,
          error: 'connection refused',
        },
        {
          name: 'linear',
          transport: 'http',
          status: 'needs-auth',
          toolCount: 0,
        },
        {
          name: 'disabled-tools',
          transport: 'stdio',
          status: 'disabled',
          toolCount: 0,
        },
      ]),
    });
    const { driver } = await makeDriver(session);
    const listMcpServers = vi.mocked(session.listMcpServers);
    const previousCalls = listMcpServers.mock.calls.length;

    driver.handleUserInput('/mcp');

    await vi.waitFor(() => {
      expect(listMcpServers).toHaveBeenCalledTimes(previousCalls + 1);
      const output = stripSgr(driver.state.transcriptContainer.render(140).join('\n'));
      expect(output).toContain(' MCP (4) ');
      expect(output).toContain('Servers');
      expect(output).toContain('local-tools');
      expect(output).toContain('connected');
      expect(output).toContain('stdio');
      expect(output).toContain('2 tools');
      expect(output).toContain('remote-tools');
      expect(output).toContain('failed');
      expect(output).toContain('connection refused');
      expect(output).toContain('linear');
      expect(output).toContain('needs auth');
      expect(output).toContain('/mcp-config login linear');
      expect(output).toContain('disabled-tools');
      expect(output).toContain('disabled');
      expect(output).toContain('1 connected · 1 needs auth · 1 failed · 1 disabled · 2 tools available');
    });
  });

  it('renders an empty /mcp state when no MCP servers are configured', async () => {
    const session = makeSession({
      listMcpServers: vi.fn(async () => []),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/mcp');

    await vi.waitFor(() => {
      const output = stripSgr(driver.state.transcriptContainer.render(120).join('\n'));
      expect(output).toContain('No MCP servers configured. Run /mcp-config to add one.');
    });
  });

  it('renders /mcp list failures as command boundary errors', async () => {
    const session = makeSession({
      listMcpServers: vi.fn(async () => {
        throw new Error('rpc unavailable');
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/mcp');

    await vi.waitFor(() => {
      const output = stripSgr(driver.state.transcriptContainer.render(120).join('\n'));
      expect(output).toContain('Error: Failed to load MCP servers: rpc unavailable');
    });
  });

  it('toggles plugin MCP servers from the text command', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins mcp enable pythinker-datasource data');

    await vi.waitFor(() => {
      expect(session.setPluginMcpServerEnabled).toHaveBeenCalledWith(
        'pythinker-datasource',
        'data',
        true,
      );
    });
  });

  it('reloads plugins through the source-compatible command', async () => {
    const session = makeSession({
      reloadPlugins: vi.fn(async () => ({
        added: ['demo'],
        removed: [],
        errors: [],
      })),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/reload-plugins');

    await vi.waitFor(() => {
      expect(session.reloadPlugins).toHaveBeenCalledOnce();
      expect(stripSgr(renderTranscript(driver))).toContain('Reload: +1 -0');
    });
  });

  it('writes source-compatible heap diagnostics from the hidden command', async () => {
    vi.mocked(performHeapDump).mockResolvedValueOnce({
      success: true,
      heapPath: '/tmp/ses-1.heapsnapshot',
      diagPath: '/tmp/ses-1-diagnostics.json',
    });
    const { driver } = await makeDriver();

    driver.handleUserInput('/heapdump');

    await vi.waitFor(() => {
      expect(performHeapDump).toHaveBeenCalledWith('ses-1', '0.0.0-test');
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Heap dump created');
      expect(transcript).toContain('/tmp/ses-1.heapsnapshot');
      expect(transcript).toContain('/tmp/ses-1-diagnostics.json');
    });
  });

  it('shows the canonical Pythinker release notes link', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/release-notes');

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Release notes');
      expect(transcript).toContain(
        'https://pymodel.github.io/pythinker-code/release-notes/changelog.html',
      );
    });
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('reports native multiline input support through /terminal-setup', async () => {
    vi.stubEnv('TERM_PROGRAM', 'Ghostty');
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/terminal-setup');

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Multiline input is ready');
      expect(transcript).toContain('Shift-Enter');
      expect(transcript).toContain('Ctrl-J');
    });
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('expands /review into the source-compatible pull request workflow', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/review 42');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('pull request 42'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('gh pr diff'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('security'));
    });
  });

  it('expands /security-review into a high-confidence branch security review', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/security-review');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('security review'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('origin/HEAD'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('80%'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Do not modify'));
    });
  });

  it('expands /pr-comments into a formatted GitHub pull request comment query', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/pr-comments 42');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('pull request 42'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('issues/{number}/comments'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('pulls/{number}/comments'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('No comments found.'));
    });
  });

  it('expands /init-verifiers into Pythinker-native functional verifier skill setup', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/init-verifiers');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(
        expect.stringContaining('.pythinker-code/skills/<verifier-name>/SKILL.md'),
      );
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('functional verification'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Do not install'));
    });
  });

  it('expands /commit into a guarded single-commit workflow', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/commit include the focused TUI changes');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Create one git commit'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Never amend'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('focused TUI changes'));
    });
  });

  it('expands /commit-push-pr into the complete guarded publishing workflow', async () => {
    const { driver, session } = await makeDriver();

    driver.handleUserInput('/commit-push-pr keep the PR focused');

    await vi.waitFor(() => {
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('push the branch'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('pull request template'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Never force-push'));
      expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('keep the PR focused'));
    });
  });

  it('errors when /plugins install has no argument', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins install');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'Usage: /plugins install <local-path-or-zip-url>',
      );
    });
    expect(session.installPlugin).not.toHaveBeenCalled();
  });

  it('installs from a positional source on /plugins install', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins install ./plugins/pythinker-datasource');

    await vi.waitFor(() => {
      expect(session.installPlugin).toHaveBeenCalledWith(
        '/tmp/proj-a/plugins/pythinker-datasource',
        undefined,
      );
    });
  });

  it('chooses Pythinker, shows loading progress, and returns to the plugin overview', async () => {
    delete process.env['PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL'];
    const originalFetch = globalThis.fetch;
    let resolveMarketplace!: (response: Response) => void;
    const marketplaceResponse = new Promise<Response>((resolveResponse) => {
      resolveMarketplace = resolveResponse;
    });
    const fetchMock = vi.fn(() => marketplaceResponse);
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession();
    const { driver } = await makeDriver(session);
    const restoreEditor = vi.spyOn(driver as unknown as PythinkerTUI, 'restoreEditor');

    try {
      driver.handleUserInput('/plugins marketplace');

      await vi.waitFor(() => {
        expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
      });
      const sourcePicker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
      const sourcePickerOutput = stripSgr(sourcePicker.render(120).join('\n'));
      expect(sourcePickerOutput).toContain('Pythinker');
      expect(sourcePickerOutput).toContain('Anthropic');
      expect(sourcePickerOutput).toContain('Custom marketplace');
      sourcePicker.handleInput('\r');

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL,
          { signal: expect.any(AbortSignal) },
        );
        expect(stripSgr(renderTranscript(driver))).toContain('Loading plugin marketplace…');
      });
      resolveMarketplace(new Response(JSON.stringify({
        plugins: [
          {
            id: 'pythinker-datasource',
            displayName: 'Pythinker Datasource',
            source: './official/pythinker-datasource.zip',
          },
        ],
      })));

      await vi.waitFor(() => {
        expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
          PluginMarketplaceSelectorComponent,
        );
      });
      const marketplacePicker = driver.state.editorContainer
        .children[0] as PluginMarketplaceSelectorComponent;
      marketplacePicker.handleInput('\u001B');

      await vi.waitFor(() => {
        expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
          PluginsOverviewSelectorComponent,
        );
      });
      expect(restoreEditor).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('loads a custom marketplace and forwards its normalized install definition', async () => {
    const marketplaceDir = await makeTempHome();
    const marketplacePath = join(marketplaceDir, 'marketplace.json');
    await writeFile(
      marketplacePath,
      JSON.stringify({
        name: 'local-marketplace',
        owner: { name: 'Example Owner' },
        plugins: [
          {
            name: 'local-review',
            displayName: 'Local Review',
            source: './local-review',
            skills: './skills',
          },
        ],
      }),
      'utf8',
    );
    const installedSummary = {
      id: 'local-review',
      displayName: 'Local Review',
      version: '1.0.0',
      description: undefined,
      enabled: true,
      state: 'ok' as const,
      source: 'local-path' as const,
      originalSource: join(marketplaceDir, 'local-review'),
      skillCount: 1,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
    };
    let resolveInstall!: (summary: typeof installedSummary) => void;
    const installPlugin = vi.fn(() => new Promise<typeof installedSummary>((resolveSummary) => {
      resolveInstall = resolveSummary;
    }));
    const session = makeSession({ installPlugin });
    const { driver } = await makeDriver(session);
    const restoreEditor = vi.spyOn(driver as unknown as PythinkerTUI, 'restoreEditor');

    driver.handleUserInput('/plugins marketplace');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
    });
    const sourcePicker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
    sourcePicker.handleInput('\u001B[B');
    sourcePicker.handleInput('\u001B[B');
    sourcePicker.handleInput('\r');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ApiKeyInputDialogComponent);
    });
    const sourceInput = driver.state.editorContainer.children[0] as ApiKeyInputDialogComponent;
    for (const char of marketplacePath) sourceInput.handleInput(char);
    expect(stripSgr(sourceInput.render(200).join('\n'))).toContain(marketplacePath);
    sourceInput.handleInput('\r');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginMarketplaceSelectorComponent,
      );
    });
    const marketplacePicker = driver.state.editorContainer
      .children[0] as PluginMarketplaceSelectorComponent;
    marketplacePicker.handleInput('\r');

    await vi.waitFor(() => {
      expect(installPlugin).toHaveBeenCalledWith(
        join(marketplaceDir, 'local-review'),
        expect.objectContaining({
          definition: expect.objectContaining({
            id: 'local-review',
            components: { skills: './skills' },
          }),
        }),
      );
      expect(stripSgr(renderTranscript(driver))).toContain('Installing or updating Local Review…');
    });
    expect(restoreEditor).not.toHaveBeenCalled();

    resolveInstall(installedSummary);
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginsOverviewSelectorComponent,
      );
    });
    expect(restoreEditor).not.toHaveBeenCalled();
  });

  it('loads Anthropic relative entries with repository install options', async () => {
    delete process.env['PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL'];
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      name: 'claude-plugins-official',
      owner: { name: 'Anthropic' },
      plugins: [
        {
          name: 'review',
          displayName: 'Review',
          source: './plugins/review',
          skills: './skills',
        },
      ],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession();
    const { driver } = await makeDriver(session);

    try {
      driver.handleUserInput('/plugins marketplace');

      await vi.waitFor(() => {
        expect(driver.state.editorContainer.children[0]).toBeInstanceOf(ChoicePickerComponent);
      });
      const sourcePicker = driver.state.editorContainer.children[0] as ChoicePickerComponent;
      sourcePicker.handleInput('\u001B[B');
      sourcePicker.handleInput('\r');

      await vi.waitFor(() => {
        expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
          PluginMarketplaceSelectorComponent,
        );
      });
      expect(fetchMock).toHaveBeenCalledWith(
        ANTHROPIC_PLUGIN_MARKETPLACE_URL,
        { signal: expect.any(AbortSignal) },
      );
      const marketplacePicker = driver.state.editorContainer
        .children[0] as PluginMarketplaceSelectorComponent;
      marketplacePicker.handleInput('\r');

      await vi.waitFor(() => {
        expect(session.installPlugin).toHaveBeenCalledWith(
          'https://github.com/anthropics/claude-plugins-official/tree/HEAD',
          expect.objectContaining({
            repositorySubdirectory: 'plugins/review',
            definition: expect.objectContaining({
              id: 'review',
              components: { skills: './skills' },
            }),
          }),
        );
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('remounts the marketplace selector after a failed install so Enter can retry', async () => {
    const marketplaceDir = await makeTempHome();
    const marketplacePath = join(marketplaceDir, 'marketplace.json');
    await writeFile(
      marketplacePath,
      JSON.stringify({
        plugins: [
          {
            id: 'retry-plugin',
            displayName: 'Retry Plugin',
            source: './retry-plugin',
          },
        ],
      }),
      'utf8',
    );
    const installedSummary = {
      id: 'retry-plugin',
      displayName: 'Retry Plugin',
      version: '1.0.0',
      description: undefined,
      enabled: true,
      state: 'ok' as const,
      source: 'local-path' as const,
      originalSource: join(marketplaceDir, 'retry-plugin'),
      skillCount: 0,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
    };
    const installPlugin = vi.fn()
      .mockRejectedValueOnce(new Error('temporary install failure'))
      .mockResolvedValueOnce(installedSummary);
    const session = makeSession({ installPlugin });
    const { driver } = await makeDriver(session);
    const restoreEditor = vi.spyOn(driver as unknown as PythinkerTUI, 'restoreEditor');

    driver.handleUserInput(`/plugins marketplace ${marketplacePath}`);

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginMarketplaceSelectorComponent,
      );
    });
    const firstPicker = driver.state.editorContainer.children[0] as PluginMarketplaceSelectorComponent;
    firstPicker.handleInput('\r');

    await vi.waitFor(() => {
      const current = driver.state.editorContainer.children[0];
      expect(current).toBeInstanceOf(PluginMarketplaceSelectorComponent);
      expect(current).not.toBe(firstPicker);
    });
    expect(installPlugin).toHaveBeenCalledTimes(1);
    expect(restoreEditor).not.toHaveBeenCalled();

    const retryPicker = driver.state.editorContainer.children[0] as PluginMarketplaceSelectorComponent;
    retryPicker.handleInput('\r');
    await vi.waitFor(() => {
      expect(installPlugin).toHaveBeenCalledTimes(2);
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginsOverviewSelectorComponent,
      );
    });
    expect(restoreEditor).not.toHaveBeenCalled();
  });

  it('toggles plugins from the overview with space', async () => {
    let enabled = true;
    const session = makeSession({
      listPlugins: vi.fn(async () => [
        {
          id: 'demo',
          displayName: 'Demo',
          version: '1.0.0',
          enabled,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
        },
      ]),
      setPluginEnabled: vi.fn(async (_id: string, nextEnabled: boolean) => {
        enabled = nextEnabled;
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginsOverviewSelectorComponent,
      );
    });
    const overview = driver.state.editorContainer.children[0] as PluginsOverviewSelectorComponent;
    overview.handleInput(' ');

    // Toggling refreshes the picker in place: it must not flash back to the
    // editor between the keypress and the refreshed picker mounting.
    expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
      PluginsOverviewSelectorComponent,
    );

    await vi.waitFor(() => {
      expect(session.setPluginEnabled).toHaveBeenCalledWith('demo', false);
    });
    // The picker stays mounted the whole time (no editor flash), so wait for the
    // refreshed render rather than for an instance swap.
    await vi.waitFor(() => {
      const refreshed = stripSgr(driver.state.editorContainer.children[0]!.render(120).join('\n'));
      expect(refreshed).toContain('❯ Demo  disabled  require run /new to apply');
    });
    const out = stripSgr(driver.state.editorContainer.children[0]!.render(120).join('\n'));
    expect(out).not.toContain('Space enable');
    expect(stripSgr(renderTranscript(driver))).not.toContain('Disabled demo. Run /new to apply.');
  });

  it('toggles plugin MCP servers from the overview MCP picker', async () => {
    const serverEnabled = new Map([
      ['metadata', true],
      ['data', true],
    ]);
    const session = makeSession({
      listPlugins: vi.fn(async () => [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 2,
          enabledMcpServerCount: 2,
          hasErrors: false,
        },
      ]),
      getPluginInfo: vi.fn(async () => ({
        id: 'pythinker-datasource',
        displayName: 'Pythinker Datasource',
        version: '1.0.0',
        enabled: true,
        state: 'ok',
        skillCount: 1,
        mcpServerCount: 2,
        enabledMcpServerCount: [...serverEnabled.values()].filter(Boolean).length,
        hasErrors: false,
        source: 'local-path',
        root: '/plugins/pythinker-datasource',
        manifest: undefined,
        mcpServers: [
          {
            name: 'metadata',
            runtimeName: 'plugin-pythinker-datasource-metadata',
            enabled: serverEnabled.get('metadata') === true,
            transport: 'stdio',
            command: 'node',
            args: ['./bin/pythinker-datasource.mjs', 'metadata'],
          },
          {
            name: 'data',
            runtimeName: 'plugin-pythinker-datasource-data',
            enabled: serverEnabled.get('data') === true,
            transport: 'stdio',
            command: 'node',
            args: ['./bin/pythinker-datasource.mjs', 'data'],
          },
        ],
        diagnostics: [],
      })),
      setPluginMcpServerEnabled: vi.fn(async (_id: string, _server: string, nextEnabled: boolean) => {
        serverEnabled.set(_server, nextEnabled);
      }),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginsOverviewSelectorComponent,
      );
    });
    const overview = driver.state.editorContainer.children[0] as PluginsOverviewSelectorComponent;
    overview.handleInput('m');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginMcpSelectorComponent,
      );
    });
    const mcpPicker = driver.state.editorContainer.children[0] as PluginMcpSelectorComponent;
    mcpPicker.handleInput('\u001B[B');
    mcpPicker.handleInput(' ');

    await vi.waitFor(() => {
      expect(session.setPluginMcpServerEnabled).toHaveBeenCalledWith(
        'pythinker-datasource',
        'data',
        false,
      );
    });
    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(PluginMcpSelectorComponent);
    });
    const out = stripSgr(driver.state.editorContainer.children[0]!.render(120).join('\n'));
    expect(out).toContain('❯ data  disabled  require run /new to apply');
    expect(stripSgr(renderTranscript(driver))).not.toContain(
      'Disabled MCP server data for pythinker-datasource. Run /new to apply.',
    );
  });

  it('requires confirmation before /plugins remove removes a plugin', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins remove demo');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(
        PluginRemoveConfirmComponent,
      );
    });
    expect(session.removePlugin).not.toHaveBeenCalled();

    const confirm = driver.state.editorContainer.children[0] as PluginRemoveConfirmComponent;
    expect(stripSgr(confirm.render(120).join('\n'))).toContain('Remove demo (demo)?');
    confirm.handleInput('\r');

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain('Remove cancelled: demo.');
    });
    expect(session.removePlugin).not.toHaveBeenCalled();
  });

  it('renders /plugins <id> info to the transcript', async () => {
    const session = makeSession({
      listPlugins: vi.fn(async () => [
        {
          id: 'demo',
          displayName: 'Demo',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
        },
      ]),
    });
    const { driver } = await makeDriver(session);

    driver.handleUserInput('/plugins demo');

    await vi.waitFor(() => {
      expect(session.getPluginInfo).toHaveBeenCalledWith('demo');
    });
  });

  it('applies /model selection with inline thinking state', async () => {
    const session = makeSession();
    const setConfig = vi.fn(async () => ({ providers: {} }));
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
          turbo: {
            provider: 'managed:kimi-code',
            model: 'pythinker-turbo',
            maxContextSize: 100,
            displayName: 'Kimi Turbo',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
      setConfig,
    });

    driver.handleUserInput('/model turbo');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(TabbedModelSelectorComponent);
    });
    const picker = driver.state.editorContainer.children[0];
    const pickerOutput = stripSgr((picker as TabbedModelSelectorComponent).render(120).join('\n'));
    expect(pickerOutput).toMatch(/Kimi K2\s+kimi-code ← current/);
    expect(pickerOutput).toMatch(/❯ Kimi Turbo\s+kimi-code/);
    (picker as TabbedModelSelectorComponent).handleInput('t');
    (picker as TabbedModelSelectorComponent).handleInput('u');
    const filteredOutput = stripSgr((picker as TabbedModelSelectorComponent).render(120).join('\n'));
    expect(filteredOutput).toContain('Search: tu');
    expect(filteredOutput).toContain('Kimi Turbo');
    expect(filteredOutput).not.toContain('Kimi K2');
    // Turbo is not the active model, but it keeps the live effort (off here)
    // instead of resetting to its first level and persisting that as default.
    (picker as TabbedModelSelectorComponent).handleInput('\r');

    await vi.waitFor(() => {
      expect(session.setModel).toHaveBeenCalledWith('turbo');
      expect(setConfig).toHaveBeenCalledWith({
        defaultModel: 'turbo',
        defaultThinking: false,
        thinking: { effort: 'off', mode: 'off' },
      });
    });
    expect(session.setThinking).not.toHaveBeenCalled();
    expect(driver.state.appState.model).toBe('turbo');
    expect(driver.state.appState.thinkingLevel).toBe('off');
  });

  it('persists /model selection even when runtime state is unchanged', async () => {
    const session = makeSession();
    const setConfig = vi.fn(async () => ({ providers: {} }));
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'old-default',
        defaultThinking: true,
      })),
      setConfig,
    });

    driver.handleUserInput('/model k2');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(TabbedModelSelectorComponent);
    });
    const picker = driver.state.editorContainer.children[0];
    (picker as TabbedModelSelectorComponent).handleInput('\r');

    await vi.waitFor(() => {
      expect(setConfig).toHaveBeenCalledWith({
        defaultModel: 'k2',
        defaultThinking: false,
        thinking: { effort: 'off', mode: 'off' },
      });
    });
    expect(session.setModel).not.toHaveBeenCalled();
    expect(session.setThinking).not.toHaveBeenCalled();
  });

  it('applies /effort with a positional level and persists it', async () => {
    const session = makeSession();
    const setConfig = vi.fn(async () => ({ providers: {} }));
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
      setConfig,
    });

    driver.handleUserInput('/effort high');

    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenCalledWith('high');
      expect(setConfig).toHaveBeenCalledWith({
        defaultModel: 'k2',
        defaultThinking: true,
        thinking: { effort: 'high', mode: 'on' },
      });
    });
    expect(driver.state.appState.thinkingLevel).toBe('high');
  });

  it('rejects an unknown /effort level and lists the valid ones', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
            supportEfforts: ['low', 'high'],
          },
        },
        defaultModel: 'k2',
      })),
    });

    driver.handleUserInput('/effort max');

    await vi.waitFor(() => {
      const transcript = stripSgr(renderTranscript(driver));
      expect(transcript).toContain('Unknown thinking effort "max"');
      expect(transcript).toContain('off, low, high');
    });
    expect(session.setThinking).not.toHaveBeenCalled();
  });

  it('opens the effort selector with /effort and applies the picked level', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
    });

    driver.handleUserInput('/effort');

    await vi.waitFor(() => {
      expect(driver.state.editorContainer.children[0]).toBeInstanceOf(EffortSelectorComponent);
    });
    const picker = driver.state.editorContainer.children[0] as EffortSelectorComponent;
    const out = stripSgr(picker.render(100).join('\n'));
    expect(out).toContain('Thinking effort');
    expect(out).toContain('off ← current');
    picker.handleInput(`${ESC}[B`); // off -> low
    picker.handleInput('\r');

    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenCalledWith('low');
    });
    expect(driver.state.appState.thinkingLevel).toBe('low');
  });

  it('cycles the thinking effort with Ctrl-T', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
    });

    driver.state.editor.handleInput('\u0014');

    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenCalledWith('low');
    });
    expect(driver.state.appState.thinkingLevel).toBe('low');

    driver.state.editor.handleInput('\u0014');
    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenCalledWith('medium');
    });
    expect(driver.state.appState.thinkingLevel).toBe('medium');
  });

  it('wraps the thinking effort back to off with Shift-Tab', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
    });

    // Shift-Tab now dispatches the same cycle as Ctrl-T (chat:thinkingToggle).
    const shiftTab = String.fromCodePoint(0x1b) + '[Z';
    for (const expected of ['low', 'medium', 'high']) {
      driver.state.editor.handleInput(shiftTab);
      await vi.waitFor(() => {
        expect(session.setThinking).toHaveBeenLastCalledWith(expected);
      });
    }
    driver.state.editor.handleInput(shiftTab);
    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenLastCalledWith('off');
    });
    expect(driver.state.appState.thinkingLevel).toBe('off');
  });

  it('keeps the prompt-box border neutral across thinking effort and permission mode', async () => {
    const session = makeSession();
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
        defaultModel: 'k2',
        defaultThinking: false,
      })),
    });

    // Non-TTY test env strips ANSI at chalk level 0; force truecolor so the
    // painted border actually carries the per-effort color codes.
    const previousLevel = chalk.level;
    chalk.level = 3;
    try {
      const tui = driver as unknown as PythinkerTUI;
      const paintAt = (thinkingLevel: string): string => {
        tui.setAppState({ thinkingLevel });
        return driver.state.editor.borderColor('─');
      };
      const offPaint = paintAt('off');
      tui.setAppState({ permissionMode: 'yolo' });
      expect(driver.state.editor.borderColor('─')).toBe(offPaint);

      tui.setAppState({ permissionMode: 'manual' });
      const perLevel = ['low', 'medium', 'high'].map(paintAt);
      for (const painted of perLevel) expect(painted).toBe(offPaint);

      tui.setAppState({ planMode: true });
      expect(driver.state.editor.borderColor('─')).toBe(currentTheme.fg('primary', '─'));
      expect(driver.state.editor.borderColor('─')).not.toBe(offPaint);
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('shows a notice instead of cycling effort when the model has no selectable levels', async () => {
    const session = makeSession({
      getStatus: vi.fn(async () => ({
        model: 'plain',
        thinkingLevel: 'off',
        permission: 'manual',
        planMode: false,
        contextTokens: 0,
        maxContextTokens: 100,
        contextUsage: 0,
      })),
    });
    const { driver } = await makeDriver(session, {
      getConfig: vi.fn(async () => ({
        models: {
          plain: {
            provider: 'managed:kimi-code',
            model: 'pythinker-plain',
            maxContextSize: 100,
            displayName: 'Plain Model',
            capabilities: [],
          },
        },
        defaultModel: 'plain',
        defaultThinking: false,
      })),
    });

    const ctrlT = String.fromCodePoint(0x14);
    driver.state.editor.handleInput(ctrlT);

    await vi.waitFor(() => {
      expect(stripSgr(renderTranscript(driver))).toContain(
        'does not offer selectable thinking effort levels',
      );
    });
    expect(session.setThinking).not.toHaveBeenCalled();
  });

  it('opens /model picker immediately from cached models and refreshes all providers in background', async () => {
    const { driver } = await makeDriver(makeSession(), {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Old Kimi K2',
            capabilities: ['thinking'],
          },
        },
      })),
    });
    const tui = driver as unknown as PythinkerTUI;
    const refreshOAuthProviderModels = vi
      .spyOn(tui.authFlow, 'refreshOAuthProviderModels')
      .mockRejectedValue(new Error('OAuth-only refresh should not run'));
    let resolveRefresh: (() => void) | undefined;
    const refreshProviderModels = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveRefresh = () => {
          tui.setAppState({
            availableModels: {
              k2: {
                provider: 'managed:kimi-code',
                model: 'pythinker-k2',
                maxContextSize: 100,
                displayName: 'Fresh Kimi K2',
                capabilities: ['thinking'],
              },
            },
          });
          resolve();
        };
      });
      return { changed: ['managed:kimi-code'], unchanged: [], failed: [] };
    });
    (
      tui.authFlow as unknown as {
        refreshProviderModels: typeof refreshProviderModels;
      }
    ).refreshProviderModels = refreshProviderModels;

    driver.handleUserInput('/model');
    await Promise.resolve();

    const firstPicker = driver.state.editorContainer.children[0];
    expect(firstPicker).toBeInstanceOf(TabbedModelSelectorComponent);
    expect(stripSgr((firstPicker as TabbedModelSelectorComponent).render(120).join('\n'))).toContain(
      'Old Kimi K2',
    );

    resolveRefresh?.();

    await vi.waitFor(() => {
      const picker = driver.state.editorContainer.children[0];
      expect(picker).toBeInstanceOf(TabbedModelSelectorComponent);
      expect(picker).not.toBe(firstPicker);
      const output = stripSgr((picker as TabbedModelSelectorComponent).render(120).join('\n'));
      expect(output).toContain('Fresh Kimi K2');
      expect(output).not.toContain('Old Kimi K2');
    });
    expect(refreshProviderModels).toHaveBeenCalledOnce();
    expect(refreshOAuthProviderModels).not.toHaveBeenCalled();
  });

  it('opens /model picker immediately while the provider refresh is still pending', async () => {
    const { driver } = await makeDriver(makeSession(), {
      getConfig: vi.fn(async () => ({
        models: {
          k2: {
            provider: 'managed:kimi-code',
            model: 'pythinker-k2',
            maxContextSize: 100,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          },
        },
      })),
    });
    const tui = driver as unknown as PythinkerTUI;
    const refreshProviderModels = vi.fn(() => new Promise<never>(() => {}));
    (
      tui.authFlow as unknown as {
        refreshProviderModels: typeof refreshProviderModels;
      }
    ).refreshProviderModels = refreshProviderModels;

    driver.handleUserInput('/model');
    await Promise.resolve();

    expect(refreshProviderModels).toHaveBeenCalledOnce();
    const picker = driver.state.editorContainer.children[0];
    expect(picker).toBeInstanceOf(TabbedModelSelectorComponent);
    const output = stripSgr((picker as TabbedModelSelectorComponent).render(120).join('\n'));
    expect(output).toContain('Kimi K2');
  });

  it('preserves the live provider tab and highlighted model when refresh resolves after moving', async () => {
    const { driver } = await makeDriver(makeSession(), {
      getConfig: vi.fn(async () => ({
        models: {
          'terra/one': {
            provider: 'terra',
            model: 'one',
            maxContextSize: 100,
            displayName: 'Terra One',
            capabilities: ['thinking'],
          },
          'terra/two': {
            provider: 'terra',
            model: 'two',
            maxContextSize: 100,
            displayName: 'Terra Two',
            capabilities: ['thinking'],
          },
          gpt: {
            provider: 'openai',
            model: 'gpt-5',
            maxContextSize: 100,
            displayName: 'GPT-5',
            capabilities: ['thinking'],
          },
        },
      })),
    });
    const tui = driver as unknown as PythinkerTUI;
    let resolveRefresh: (() => void) | undefined;
    const refreshProviderModels = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveRefresh = () => {
          tui.setAppState({
            availableModels: {
              'terra/one': {
                provider: 'terra',
                model: 'one',
                maxContextSize: 100,
                displayName: 'Terra One Fresh',
                capabilities: ['thinking'],
              },
              'terra/two': {
                provider: 'terra',
                model: 'two',
                maxContextSize: 100,
                displayName: 'Terra Two Fresh',
                capabilities: ['thinking'],
              },
              gpt: {
                provider: 'openai',
                model: 'gpt-5',
                maxContextSize: 100,
                displayName: 'GPT-5 Fresh',
                capabilities: ['thinking'],
              },
            },
          });
          resolve();
        };
      });
      return { changed: ['terra', 'openai'], unchanged: [], failed: [] };
    });
    (
      tui.authFlow as unknown as {
        refreshProviderModels: typeof refreshProviderModels;
      }
    ).refreshProviderModels = refreshProviderModels;

    driver.handleUserInput('/model');
    await Promise.resolve();

    const firstPicker = driver.state.editorContainer.children[0];
    expect(firstPicker).toBeInstanceOf(TabbedModelSelectorComponent);
    (firstPicker as TabbedModelSelectorComponent).handleInput('\t');
    (firstPicker as TabbedModelSelectorComponent).handleInput('\u001B[B');

    resolveRefresh?.();

    await vi.waitFor(() => {
      const picker = driver.state.editorContainer.children[0];
      expect(picker).toBeInstanceOf(TabbedModelSelectorComponent);
      expect(picker).not.toBe(firstPicker);
      const output = stripSgr((picker as TabbedModelSelectorComponent).render(120).join('\n'));
      expect(output).toContain('Terra One Fresh');
      expect(output).toContain('Terra Two Fresh');
      expect(output).not.toContain('GPT-5 Fresh');
      expect(output).toMatch(/❯ Terra Two Fresh/);
      expect(output).not.toMatch(/❯ Terra One Fresh/);
    });
  });

  it('enables search in the shared model selector helper', async () => {
    const { driver } = await makeDriver();
    const selection = runModelSelector(driver as any, {
      alpha: {
        provider: 'managed:kimi-code',
        model: 'pythinker-alpha',
        maxContextSize: 100,
        displayName: 'Pythinker Alpha',
        capabilities: ['thinking'],
      },
      turbo: {
        provider: 'managed:kimi-code',
        model: 'pythinker-turbo',
        maxContextSize: 100,
        displayName: 'Kimi Turbo',
        capabilities: ['thinking'],
      },
    });

    const picker = driver.state.editorContainer.children[0];
    expect(picker).toBeInstanceOf(ModelSelectorComponent);
    (picker as ModelSelectorComponent).handleInput('t');
    (picker as ModelSelectorComponent).handleInput('u');

    const output = stripSgr((picker as ModelSelectorComponent).render(120).join('\n'));
    expect(output).toContain('Search: tu');
    expect(output).toContain('Kimi Turbo');
    expect(output).not.toContain('Pythinker Alpha');

    (picker as ModelSelectorComponent).handleInput('\u001B');
    (picker as ModelSelectorComponent).handleInput('\u001B');
    await expect(selection).resolves.toBeUndefined();
  });

  it('deletes Kitty inline images when /new clears the transcript', async () => {
    setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: true });
    const { driver, harness } = await makeDriver(makeSession({ id: 'ses-1' }));
    const nextSession = makeSession({ id: 'ses-2' });
    harness.createSession.mockResolvedValueOnce(nextSession);
    const write = vi.spyOn(driver.state.terminal, 'write').mockImplementation(() => {});

    driver.handleUserInput('/new');

    await vi.waitFor(() => {
      expect(harness.createSession).toHaveBeenCalledTimes(2);
      expect(driver.getCurrentSessionId()).toBe('ses-2');
    });
    expect(write).toHaveBeenCalledWith(deleteAllKittyImages());
  });

  it('updates terminal title through pi-tui without changing process title', async () => {
    const originalTitle = process.title;
    const { driver } = await makeDriver(makeSession({ id: 'ses-1' }));
    const setTitle = vi.spyOn(driver.state.terminal, 'setTitle').mockImplementation(() => {});

    try {
      process.title = 'pythinker-test-runner';
      driver.sessionEventHandler.handleEvent(
        {
          type: 'session.meta.updated',
          sessionId: 'ses-1',
          agentId: 'main',
          title: 'Implement terminal title',
        } as Event,
        () => {},
      );

      expect(setTitle).toHaveBeenCalledWith('Implement terminal title');
      expect(process.title).toBe('pythinker-test-runner');
    } finally {
      process.title = originalTitle;
    }
  });

  it('forks the active session and switches to the returned session', async () => {
    const originalTitle = process.title;
    const source = makeSession({
      id: 'ses-source',
      summary: { title: 'Source title' },
    });
    const forked = makeSession({
      id: 'ses-fork',
      summary: { title: 'Fork: Source title' },
    });
    const forkSession = vi.fn(async () => forked);
    const { driver, harness } = await makeDriver(source, { forkSession });
    const setTitle = vi.spyOn(driver.state.terminal, 'setTitle').mockImplementation(() => {});

    try {
      process.title = 'pythinker-test-runner';
      driver.handleUserInput('/fork ignored args');

      await vi.waitFor(() => {
        expect(forkSession).toHaveBeenCalledWith({
          id: 'ses-source',
          title: 'Fork: Source title',
        });
        expect(driver.getCurrentSessionId()).toBe('ses-fork');
      });
      expect(setTitle).toHaveBeenCalledWith('Fork: Source title');
      expect(process.title).toBe('pythinker-test-runner');
      expect(source.close).toHaveBeenCalledOnce();
      expect(forked.onEvent).toHaveBeenCalledOnce();
      expect(harness.resumeSession).not.toHaveBeenCalled();
      expect(driver.state.transcriptContainer.render(120).join('\n')).toContain(
        'Session forked (ses-fork). To return to the original session: pythinker -r ses-source',
      );
    } finally {
      process.title = originalTitle;
    }
  });

  it('keeps the current session when fork fails', async () => {
    const forkSession = vi.fn(async () => {
      throw new Error('fork unavailable');
    });
    const { driver } = await makeDriver(makeSession({ id: 'ses-source' }), { forkSession });

    driver.handleUserInput('/fork');

    await vi.waitFor(() => {
      expect(forkSession).toHaveBeenCalledWith({
        id: 'ses-source',
        title: 'Fork: ses-source',
      });
      expect(driver.getCurrentSessionId()).toBe('ses-source');
      expect(driver.state.transcriptContainer.render(120).join('\n')).toContain(
        'Failed to fork session: fork unavailable',
      );
    });
  });

  it('does not create a thinking component for empty thinking deltas', async () => {
    const { driver } = await makeDriver();
    driver.state.appState.streamingPhase = 'thinking';
    driver.state.appState.streamingStartTime = 1;

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: '',
      } as Event,
      vi.fn(),
    );

    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(false);
  });

  it('does not create a thinking component for whitespace-only thinking deltas', async () => {
    const { driver } = await makeDriver();
    driver.state.appState.streamingPhase = 'waiting';

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: ' ',
      } as Event,
      vi.fn(),
    );
    driver.streamingUI.flushNow();

    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(false);
    expect(driver.state.appState.streamingPhase).toBe('waiting');

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: 'visible reasoning',
      } as Event,
      vi.fn(),
    );
    driver.streamingUI.flushNow();

    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(true);
    expect(driver.state.appState.streamingPhase).toBe('thinking');
    // Collapsed live thinking renders only the spinner header, never the text.
    expect(stripSgr(renderTranscript(driver))).not.toContain('visible reasoning');
  });

  it('does not create a thinking component for whitespace-only replay content', async () => {
    const { driver } = await makeDriver();

    driver.streamingUI.onThinkingUpdate(' \n\t');
    driver.streamingUI.onThinkingEnd();

    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(false);
    expect(
      driver.state.transcriptContainer.children.filter(
        (child) => child instanceof ThinkingComponent,
      ),
    ).toHaveLength(0);
  });

  it('finalizes an orphaned thinking component on turn end', async () => {
    const { driver } = await makeDriver();
    driver.state.appState.streamingPhase = 'thinking';
    driver.state.appState.streamingStartTime = 1;
    const sendQueued = vi.fn();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: 'leaked',
      } as Event,
      vi.fn(),
    );
    driver.streamingUI.flushNow();
    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(true);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        reason: 'completed',
      } as Event,
      sendQueued,
    );

    expect(driver.streamingUI.hasActiveThinkingComponent()).toBe(false);
  });

  it('renders newly streamed thinking expanded when ctrl+o toggle was already active', async () => {
    const { driver } = await makeDriver();
    driver.state.toolOutputExpanded = true;

    const longThinking = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'].join('\n');
    driver.sessionEventHandler.handleEvent(
      {
        type: 'thinking.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: longThinking,
      } as Event,
      vi.fn(),
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        delta: 'answer',
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('t7');
    expect(transcript).not.toContain('ctrl+o expand');
  });

  it('renders hook results without XML tags', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'hook.result',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        hookEvent: 'UserPromptSubmit',
        content: '{}',
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('UserPromptSubmit hook');
    expect(transcript).toContain('{}');
    expect(transcript).not.toContain('<hook_result');
  });

  it('renders empty hook results as empty status text', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'hook.result',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        hookEvent: 'UserPromptSubmit',
        content: '',
      } as Event,
      vi.fn(),
    );

    const transcript = stripSgr(renderTranscript(driver));
    expect(transcript).toContain('UserPromptSubmit hook');
    expect(transcript).toContain('(empty)');
    expect(transcript).not.toContain('<hook_result');
  });
});

describe('message-flow feature parity baseline', () => {
  it('links streaming completion and interaction behavior to active parity scenarios', () => {
    const linked = PARITY_CASES.filter(
      ({ legacyTest }) => legacyTest === LEGACY_TEST_PATHS.messageFlow,
    );
    expect(linked.length).toBeGreaterThan(0);
    expect(
      linked.every(({ status, scenarioId }) => status === 'active' && scenarioId.length > 0),
    ).toBe(true);
  });
});

describe('scrollback bridge wiring', () => {
  it('mirrors assistant text into scrollback when a bridge is attached', async () => {
    const { driver } = await makeDriver();
    const written: string[] = [];
    driver.streamingUI.setScrollbackBridge(
      new ScrollbackBridge({ sink: (text) => written.push(text) }),
    );

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        delta: '# Heading\n\ntail text',
      } as Event,
      vi.fn(),
    );
    driver.streamingUI.flushNow();

    // The completed block is committed; the incomplete tail is still retained.
    expect(written).toEqual(['# Heading\n']);

    driver.streamingUI.finalizeAssistantStream();
    expect(written).toEqual(['# Heading\n', 'tail text\n']);
  });

  it('writes nothing when no bridge is attached', async () => {
    const { driver } = await makeDriver();

    driver.sessionEventHandler.handleEvent(
      {
        type: 'assistant.delta',
        agentId: 'main',
        sessionId: 'ses-1',
        turnId: 1,
        delta: '# Heading\n\ntail text',
      } as Event,
      vi.fn(),
    );
    driver.streamingUI.flushNow();
    driver.streamingUI.finalizeAssistantStream();

    expect(stripSgr(renderTranscript(driver))).toContain('Heading');
  });
});

describe('scrollback bridge thinking wiring', () => {
  it('mirrors thinking text into scrollback and closes it on end', async () => {
    const { driver } = await makeDriver();
    const written: string[] = [];
    driver.streamingUI.setScrollbackBridge(
      new ScrollbackBridge({ sink: (text) => written.push(text) }),
    );

    driver.streamingUI.onThinkingUpdate('Considering options\n\nstill going');
    expect(written).toEqual(['Considering options\n']);

    driver.streamingUI.onThinkingEnd();
    expect(written).toEqual(['Considering options\n', 'still going\n']);

    // A second block must not reopen the finished entry.
    driver.streamingUI.onThinkingUpdate('A later thought\n\n');
    driver.streamingUI.onThinkingEnd();
    expect(written).toEqual([
      'Considering options\n',
      'still going\n',
      'A later thought\n',
    ]);
  });
});
