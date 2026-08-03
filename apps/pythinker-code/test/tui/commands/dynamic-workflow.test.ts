import { describe, expect, it, vi } from 'vitest';

import { handleDynamicWorkflowCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { currentTheme } from '#/tui/theme';

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

interface TestComponent {
  render(width: number): string[];
}

function makeHost(
  overrides: {
    model?: string;
    hasSession?: boolean;
    permissionMode?: 'manual' | 'auto' | 'yolo';
    dynamicWorkflowMode?: boolean;
  } = {},
) {
  const session = {
    setPermission: vi.fn(async () => {}),
    setDynamicWorkflowMode: vi.fn(async () => {}),
  };
  const hasSession = overrides.hasSession ?? true;
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'pythinker-model',
        permissionMode: overrides.permissionMode ?? 'auto',
        dynamicWorkflowMode: overrides.dynamicWorkflowMode ?? false,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session: hasSession ? session : undefined,
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

interface TestPicker {
  handleInput(data: string): void;
  render(width: number): string[];
}

function mountedPicker(host: SlashCommandHost): TestPicker {
  const mock = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0]?.[0] as TestPicker;
}

function markerAddChild(host: SlashCommandHost): ReturnType<typeof vi.fn> {
  return host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>;
}

function expectDynamicWorkflowMarker(host: SlashCommandHost, text: string): void {
  const components = markerAddChild(host).mock.calls.map(([component]) => component as TestComponent);
  const rendered = stripAnsi(components.at(-1)?.render(80).join('\n') ?? '');
  expect(rendered).toContain(text);
}

describe('handleDynamicWorkflowCommand', () => {
  it('sends the Dynamic Workflow prompt as a normal prompt after enabling Dynamic Workflow mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');

    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    expect(host.state.dynamicWorkflowModeEntry).toBe('task');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('sends the Dynamic Workflow prompt without re-entering Dynamic Workflow mode when already on', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto', dynamicWorkflowMode: true });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');

    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(host.state.dynamicWorkflowModeEntry).toBeUndefined();
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('turns Dynamic Workflow mode on without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '' });

    await handleDynamicWorkflowCommand(host, 'on');

    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(host.state.dynamicWorkflowModeEntry).toBe('manual');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before turning Dynamic Workflow mode on in Manual mode', async () => {
    const { host, session } = makeHost({ model: '', permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'on');

    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block Dynamic Workflow work');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'manual');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(host.state.dynamicWorkflowModeEntry).toBe('manual');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns Dynamic Workflow mode on when called without args while Dynamic Workflow mode is off', async () => {
    const { host, session } = makeHost({ model: '', dynamicWorkflowMode: false });

    await handleDynamicWorkflowCommand(host, '');

    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(host.state.dynamicWorkflowModeEntry).toBe('manual');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when Dynamic Workflow mode is already on', async () => {
    const { host, session } = makeHost({ model: '', dynamicWorkflowMode: true });

    await handleDynamicWorkflowCommand(host, 'on');

    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Dynamic Workflow mode is already on.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns Dynamic Workflow mode off without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '', dynamicWorkflowMode: true });

    await handleDynamicWorkflowCommand(host, 'off');

    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(false, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: false });
    expect(host.state.dynamicWorkflowModeEntry).toBeUndefined();
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow deactivated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns Dynamic Workflow mode off when called without args while Dynamic Workflow mode is on', async () => {
    const { host, session } = makeHost({ model: '', dynamicWorkflowMode: true });

    await handleDynamicWorkflowCommand(host, '');

    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(false, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: false });
    expect(host.state.dynamicWorkflowModeEntry).toBeUndefined();
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow deactivated');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when Dynamic Workflow mode is already off', async () => {
    const { host, session } = makeHost({ model: '', dynamicWorkflowMode: false });

    await handleDynamicWorkflowCommand(host, 'off');

    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ dynamicWorkflowMode: false });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Dynamic Workflow mode is already off.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before starting a Dynamic Workflow task in Manual mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');

    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block Dynamic Workflow work');
    expect(text).toContain('Switch to YOLO and start');
    expect(text).not.toContain('Do not start');
  });

  it('defaults to Auto when confirming a Manual-mode Dynamic Workflow start', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(host.state.dynamicWorkflowModeEntry).toBe('task');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
  });

  it('can start a Manual-mode Dynamic Workflow task without changing permission', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledTimes(1);
    expect(host.state.dynamicWorkflowModeEntry).toBe('task');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
  });

  it('can start a Manual-mode Dynamic Workflow task after switching to YOLO', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('yolo');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
    expect(host.setAppState).toHaveBeenCalledWith({ dynamicWorkflowMode: true });
    expect(host.state.dynamicWorkflowModeEntry).toBe('task');
    expectDynamicWorkflowMarker(host, 'Dynamic Workflow activated');
  });

  it('returns the command to the input box when a Manual-mode Dynamic Workflow start is cancelled', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ESCAPE);

    expect(host.restoreInputText).toHaveBeenCalledWith('/workflow Ship feature X');
    expect(host.showStatus).toHaveBeenCalledWith('Dynamic Workflow task not started.');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not start when permission update fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setPermission.mockRejectedValueOnce(new Error('denied'));

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set permission mode'),
      );
    });
    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send from Manual mode when enabling Dynamic Workflow mode fails after confirmation', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setDynamicWorkflowMode.mockRejectedValueOnce(new Error('denied'));

    await handleDynamicWorkflowCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enable Dynamic Workflow mode'),
      );
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setDynamicWorkflowMode).toHaveBeenCalledWith(true, 'task');
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send a prompt when enabling Dynamic Workflow mode fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });
    session.setDynamicWorkflowMode.mockRejectedValueOnce(new Error('denied'));

    await handleDynamicWorkflowCommand(host, 'Ship feature X');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enable Dynamic Workflow mode'),
    );
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});
