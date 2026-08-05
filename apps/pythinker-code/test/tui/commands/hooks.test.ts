import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import { handleDebugCommand } from '#/tui/commands/debug';
import {
  handleDoctorCommand,
  handleHooksCommand,
  showContextReport,
  showContextFiles,
} from '#/tui/commands/info';

describe('debug slash command', () => {
  it('injects the bounded current-session log tail and issue description', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pythinker-debug-'));
    const sessionDir = join(root, 'session');
    const logPath = join(sessionDir, 'logs', 'pythinker-code.log');
    await mkdir(join(sessionDir, 'logs'), { recursive: true });
    await writeFile(
      logPath,
      `old marker\n${'discarded line\n'.repeat(6_000)}[WARN] newest failure\n`,
    );
    const sendNormalUserInput = vi.fn();
    const host = {
      harness: { homeDir: root },
      session: { id: 'session-1', summary: { sessionDir } },
      state: { appState: { model: 'test-model' } },
      sendNormalUserInput,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    try {
      await handleDebugCommand(host, 'the renderer wrapped a tool row');
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const prompt = String(sendNormalUserInput.mock.calls[0]?.[0]);
    expect(prompt).toContain(logPath);
    expect(prompt).toContain('[WARN] newest failure');
    expect(prompt).not.toContain('old marker');
    expect(prompt).toContain('the renderer wrapped a tool row');
  });
});

describe('hooks slash command', () => {
  it('renders configured command hooks with their event, matcher, and timeout', async () => {
    const showNotice = vi.fn();
    const host = {
      harness: {
        getConfig: vi.fn(async () => ({
          providers: {},
          hooks: [
            {
              event: 'PreToolUse',
              matcher: '^Bash$',
              command: 'check-command',
              timeout: 5,
              once: true,
              async: true,
              statusMessage: 'Checking command',
            },
            {
              event: 'Stop',
              command: 'verify-result',
              asyncRewake: true,
              shell: 'powershell',
            },
            {
              event: 'Notification',
              type: 'http',
              url: 'https://hooks.example.test/notify',
              headers: { Authorization: 'Bearer SECRET' },
              async: true,
            },
            {
              event: 'Stop',
              type: 'prompt',
              prompt: 'Check the result',
              model: 'fast-model',
              if: 'Bash(git *)',
            },
            {
              event: 'Stop',
              type: 'agent',
              prompt: 'Verify the repository',
            },
          ],
        })),
      },
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleHooksCommand(host, '');

    expect(showNotice).toHaveBeenCalledWith(
      'Hooks (5)',
      'PreToolUse · ^Bash$ · check-command · 5s · once · async · status Checking command\n' +
        'Stop · all · verify-result · 30s · async rewake · powershell\n' +
        'Notification · all · https://hooks.example.test/notify · 30s · async\n' +
        'Stop · all · Check the result · 30s · if Bash(git *) · model fast-model\n' +
        'Stop · all · Verify the repository · 60s',
    );
    expect(showNotice.mock.calls[0]?.[1]).not.toContain('SECRET');
  });
});

describe('files slash command', () => {
  it('lists read files relative to the working directory', async () => {
    const host = {
      state: { appState: { workDir: '/workspace' } },
      requireSession: () => ({
        listContextFiles: vi.fn(async () => [
          '/workspace/src/main.ts',
          '/tmp/shared.ts',
        ]),
      }),
      showNotice: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await showContextFiles(host, '');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Files in context (2)',
      `src/main.ts\n../tmp/shared.ts`,
    );
  });
});

describe('context slash command', () => {
  it('renders the model-visible context report in the existing usage panel', async () => {
    const addChild = vi.fn();
    const requestRender = vi.fn();
    const host = {
      state: {
        transcriptContainer: { addChild },
        ui: { requestRender },
      },
      requireSession: () => ({
        getContextUsage: vi.fn(async () => ({
          model: 'mock-model',
          estimatedTokens: 2_500,
          maxTokens: 10_000,
          percentage: 25,
          messageCount: 2,
          categories: [
            { name: 'System prompt', tokens: 1_000, percentage: 10 },
            { name: 'Free space', tokens: 7_500, percentage: 75 },
          ],
          tools: [],
        })),
      }),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await showContextReport(host, '');

    expect(addChild).toHaveBeenCalledOnce();
    const panel = addChild.mock.calls[0]?.[0] as { render(width: number): string[] };
    expect(panel.render(100).join('\n')).toContain('Context');
    expect(panel.render(100).join('\n')).toContain('mock-model');
    expect(requestRender).toHaveBeenCalledOnce();
  });
});

describe('doctor slash command', () => {
  it('reuses the CLI validators and reports keybinding warnings', async () => {
    const showNotice = vi.fn();
    const host = {
      state: { appState: { workDir: '/workspace' } },
      harness: {
        homeDir: '/missing-pythinker-doctor-home',
        configPath: '/missing-pythinker-doctor-home/config.toml',
        getConfigDiagnostics: vi.fn(async () => ({
          warnings: ['config.toml kept the previous valid configuration'],
        })),
        listAgentProfiles: vi.fn(async () => ({
          profiles: [
            {
              name: 'verbose-agent',
              source: 'project',
              tools: [],
              subagents: [],
              whenToUse: 'x'.repeat(60_100),
            },
          ],
          warnings: [{ path: '/workspace/.pythinker-code/agents/bad.yaml', error: 'Invalid YAML' }],
        })),
      },
      session: {
        getContextUsage: vi.fn(async () => ({
          estimatedTokens: 30_000,
          maxTokens: 100_000,
          percentage: 30,
          messageCount: 1,
          categories: [],
          tools: [{ name: 'mcp__large__tool', source: 'mcp', tokens: 25_001 }],
        })),
        listPlugins: vi.fn(async () => [
          {
            id: 'broken-plugin',
            displayName: 'Broken plugin',
            enabled: true,
            state: 'error',
            skillCount: 0,
            mcpServerCount: 0,
            enabledMcpServerCount: 0,
            hasErrors: true,
            source: 'local-path',
          },
        ]),
        getPluginInfo: vi.fn(async () => ({
          diagnostics: [{ severity: 'error', message: 'Manifest is invalid' }],
        })),
      },
      reloadKeybindings: vi.fn(() => ['Invalid keybinding override.']),
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleDoctorCommand(host, '');

    expect(showNotice).toHaveBeenCalledOnce();
    expect(showNotice.mock.calls[0]?.[0]).toBe('Doctor found warnings');
    expect(showNotice.mock.calls[0]?.[1]).toContain('SKIP config.toml');
    expect(showNotice.mock.calls[0]?.[1]).toContain('SKIP tui.toml');
    expect(showNotice.mock.calls[0]?.[1]).toContain('Invalid keybinding override.');
    expect(showNotice.mock.calls[0]?.[1]).toContain(
      'config.toml kept the previous valid configuration',
    );
    expect(showNotice.mock.calls[0]?.[1]).toContain(
      '/workspace/.pythinker-code/agents/bad.yaml: Invalid YAML',
    );
    expect(showNotice.mock.calls[0]?.[1]).toContain(
      'broken-plugin: Manifest is invalid',
    );
    expect(showNotice.mock.calls[0]?.[1]).toContain('Large agent descriptions');
    expect(showNotice.mock.calls[0]?.[1]).toContain('Large MCP tools context');
  });
});
