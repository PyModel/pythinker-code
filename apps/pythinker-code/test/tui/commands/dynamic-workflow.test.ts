import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { describe, expect, it, vi } from 'vitest';

import { handleDynamicWorkflowCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { setDynamicWorkflowDisabled, setWorkflowSizeGuideline } from '#/tui/commands/workflow-availability';
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
    availableModels?: Record<string, unknown>;
    workDir?: string;
    lastDynamicWorkflowArgs?: Record<string, unknown>;
  } = {},
) {
  const session = {
    setPermission: vi.fn(async () => {}),
    setDynamicWorkflowMode: vi.fn(async () => {}),
    reloadSkills: vi.fn(async () => {}),
  };
  const hasSession = overrides.hasSession ?? true;
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'pythinker-model',
        permissionMode: overrides.permissionMode ?? 'auto',
        dynamicWorkflowMode: overrides.dynamicWorkflowMode ?? false,
        availableModels: overrides.availableModels ?? {
          'deepseek-v4': { provider: 'deepseek', model: 'deepseek-v4' },
        },
        workDir: overrides.workDir ?? '/workspace',
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      lastDynamicWorkflowArgs: overrides.lastDynamicWorkflowArgs,
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
    refreshSkillCommands: vi.fn(async () => {}),
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
  it('refuses to run when Dynamic Workflow is disabled by configuration', async () => {
    setDynamicWorkflowDisabled(true, {});

    try {
      const { host, session } = makeHost({ permissionMode: 'auto' });

      await handleDynamicWorkflowCommand(host, 'Ship feature X');

      expect(host.showError).toHaveBeenCalledWith('Dynamic Workflow is disabled by configuration.');
      expect(host.sendNormalUserInput).not.toHaveBeenCalled();
      expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
      expect(markerAddChild(host)).not.toHaveBeenCalled();
    } finally {
      setDynamicWorkflowDisabled(false, {});
    }
  });

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

  it('sets, reports, and clears the Dynamic Workflow subagent model', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'model');
    expect(host.showStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('use this session model'),
    );

    await handleDynamicWorkflowCommand(host, 'model deepseek-v4');
    expect(host.showStatus).toHaveBeenLastCalledWith('Dynamic Workflow subagents will use deepseek-v4.');
    expect(host.state.appState.dynamicWorkflowModel).toBe('deepseek-v4');

    await handleDynamicWorkflowCommand(host, 'model');
    expect(host.showStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('subagents use deepseek-v4'),
    );

    await handleDynamicWorkflowCommand(host, 'model off');
    expect(host.showStatus).toHaveBeenLastCalledWith(
      'Dynamic Workflow subagents now use this session model.',
    );
    expect(host.state.appState.dynamicWorkflowModel).toBeUndefined();

    // A model subcommand must never be mistaken for a task prompt.
    expect(session.setDynamicWorkflowMode).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('rejects a model alias that is not configured', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'model not-a-real-alias');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Unknown model: not-a-real-alias'),
    );
    expect(host.state.appState.dynamicWorkflowModel).toBeUndefined();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks the task to route subagents to the configured model', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'model deepseek-v4');
    await handleDynamicWorkflowCommand(host, 'Audit every route for missing auth');

    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      'Audit every route for missing auth\n\nUse model "deepseek-v4" for the DynamicWorkflow subagents in this task.',
    );
  });
});

describe('/workflow save', () => {
  it('writes the last run as a skill and refreshes the command list', async () => {
    const workDir = await fs.mkdtemp(join(tmpdir(), 'workflow-save-'));
    try {
      const { host, session } = makeHost({
        permissionMode: 'auto',
        workDir,
        lastDynamicWorkflowArgs: {
          description: 'Audit routes for missing auth',
          subagent_type: 'reviewer',
          prompt_template: 'Audit {{item}}',
          model: 'deepseek-v4',
          items: ['a.ts', 'b.ts'],
        },
      });

      await handleDynamicWorkflowCommand(host, 'save Audit Routes');

      const saved = await fs.readFile(
        join(workDir, '.pythinker-code', 'skills', 'audit-routes', 'SKILL.md'),
        'utf8',
      );
      expect(saved).toContain('name: "audit-routes"');
      expect(saved).toContain('description: "Audit routes for missing auth"');
      expect(saved).toContain('subagent-type: "reviewer"');
      expect(saved).toContain('Audit {{item}}');
      // Re-discovery must happen before the command set is rebuilt, or the
      // freshly written skill is rebuilt from a registry that never saw it.
      expect(session.reloadSkills).toHaveBeenCalledOnce();
      expect(host.refreshSkillCommands).toHaveBeenCalledWith(session);
      expect(session.reloadSkills.mock.invocationCallOrder[0]).toBeLessThan(
        (host.refreshSkillCommands as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0,
      );
      expect(host.showError).not.toHaveBeenCalled();
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it('refuses a name that would escape the project skills directory', async () => {
    const workDir = await fs.mkdtemp(join(tmpdir(), 'workflow-save-'));
    try {
      const { host, session } = makeHost({
        permissionMode: 'auto',
        workDir,
        lastDynamicWorkflowArgs: { description: 'Audit routes' },
      });

      await handleDynamicWorkflowCommand(host, 'save ../../../../tmp/pwned');

      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('not a valid skill name'),
      );
      expect(host.refreshSkillCommands).not.toHaveBeenCalled();
      expect(session.reloadSkills).not.toHaveBeenCalled();
      await expect(fs.stat(join(workDir, '.pythinker-code'))).rejects.toThrow(/ENOENT/u);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it('explains itself when no workflow has run yet', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'save nightly-audit');

    expect(host.showError).toHaveBeenCalledWith(
      'No Dynamic Workflow has run in this session yet.',
    );
  });

  it('asks for a name when given none', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'save');

    expect(host.showError).toHaveBeenCalledWith('Usage: /workflow save <name> [--personal]');
  });

  it('asks for a name when given only the --personal flag', async () => {
    const { host } = makeHost({ permissionMode: 'auto' });

    await handleDynamicWorkflowCommand(host, 'save --personal');

    expect(host.showError).toHaveBeenCalledWith('Usage: /workflow save <name> [--personal]');
  });

  it('saves --personal into the data dir and records the size guideline', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'workflow-home-'));
    vi.stubEnv('PYTHINKER_CODE_HOME', home);
    // Explicit empty env: the default is process.env, where an exported
    // PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE would override 'small' and fail
    // this test for reasons unrelated to the change under test.
    setWorkflowSizeGuideline('small', {});
    try {
      const { host, session } = makeHost({
        permissionMode: 'auto',
        lastDynamicWorkflowArgs: { description: 'Audit routes for missing auth' },
      });

      await handleDynamicWorkflowCommand(host, 'save --personal Audit Routes');

      const saved = await fs.readFile(join(home, 'skills', 'audit-routes', 'SKILL.md'), 'utf8');
      expect(saved).toContain('name: "audit-routes"');
      expect(saved).toContain('size-guideline: "small"');
      // The body line is what shapes the re-run; the frontmatter alone is inert.
      expect(saved).toContain('at most about 5 subagents');
      expect(session.reloadSkills).toHaveBeenCalledOnce();
      expect(host.showError).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      // The module-level cache cannot return to unset; the resolved default
      // ('medium') matches what TUI startup would have cached in production.
      setWorkflowSizeGuideline(undefined, {});
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('rejects --personal when it is repeated or not at either end', async () => {
    for (const input of [
      'save Audit --personal Routes',
      'save --personal Audit --personal',
      'save --personal --personal',
    ]) {
      const { host } = makeHost({ permissionMode: 'auto' });

      await handleDynamicWorkflowCommand(host, input);

      expect(host.showError).toHaveBeenCalledWith('Usage: /workflow save <name> [--personal]');
    }
  });
});
