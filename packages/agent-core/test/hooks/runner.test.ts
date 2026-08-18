import { describe, expect, it, vi } from 'vitest';

// Delegates to the real `spawn` so every other test in this file keeps running
// actual processes; the wrapper exists only so the PowerShell test can assert
// which binary was launched instead of waiting on its output.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

import { buildHookSpawnOptions } from '../../src/session/hooks/runner';

const RUNNER_MODULE = '../../src/session/hooks/runner' as string;

interface HookResult {
  action: 'allow' | 'block';
  message?: string;
  retry?: boolean;
  watchPaths?: readonly string[];
  reason?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  structuredOutput?: boolean;
  elicitationResponse?: {
    readonly action: 'accept' | 'decline' | 'cancel';
    readonly content?: Record<string, string | number | boolean | string[]>;
  };
}

type RunHook = (
  command: string,
  input: Record<string, unknown>,
  options: { timeout: number; cwd?: string; shell?: 'bash' | 'powershell' },
) => Promise<HookResult>;

async function importRunHook(): Promise<RunHook> {
  const mod = (await import(RUNNER_MODULE)) as { runHook: RunHook };
  return mod.runHook;
}

describe('runHook process runner', () => {
  it('returns allow when the hook exits 0 and captures stdout', async () => {
    const runHook = await importRunHook();
    const result = await runHook('echo ok', { tool_name: 'Shell' }, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.stdout?.trim()).toBe('ok');
  });

  it('parses stdout JSON message into a hook result message', async () => {
    const runHook = await importRunHook();
    const result = await runHook("node -e \"process.stdout.write(JSON.stringify({message:'hook says hi'}))\"", {}, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.message).toBe('hook says hi');
    expect(result.structuredOutput).toBe(true);
  });

  it('parses dynamic file watch paths from hook-specific output', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      'echo \'{"hookSpecificOutput":{"watchPaths":["/tmp/.env","/tmp/.env.local"]}}\'',
      {},
      { timeout: 5 },
    );

    expect(result.watchPaths).toEqual(['/tmp/.env', '/tmp/.env.local']);
  });

  it('parses PermissionDenied retry guidance from hook-specific output', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      'echo \'{"hookSpecificOutput":{"retry":true}}\'',
      {},
      { timeout: 5 },
    );

    expect(result.retry).toBe(true);
  });

  it('parses an MCP elicitation response from hook-specific output', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      'echo \'{"hookSpecificOutput":{"action":"accept","content":{"name":"Ada","enabled":true}}}\'',
      {},
      { timeout: 5 },
    );

    expect(result.elicitationResponse).toEqual({
      action: 'accept',
      content: { name: 'Ada', enabled: true },
    });
  });

  it('marks structured stdout JSON without message as empty hook output', async () => {
    const runHook = await importRunHook();

    const emptyObject = await runHook("node -e \"process.stdout.write('{}')\"", {}, { timeout: 5 });
    expect(emptyObject.action).toBe('allow');
    expect(emptyObject.message).toBeUndefined();
    expect(emptyObject.structuredOutput).toBe(true);

    const emptyHookSpecificOutput = await runHook(
      "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{}}))\"",
      {},
      { timeout: 5 },
    );
    expect(emptyHookSpecificOutput.action).toBe('allow');
    expect(emptyHookSpecificOutput.message).toBeUndefined();
    expect(emptyHookSpecificOutput.structuredOutput).toBe(true);
  });

  it('returns block when the hook exits 2 and captures stderr as the reason', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      "node -e \"process.stderr.write('blocked');process.exit(2)\"",
      { tool_name: 'Shell' },
      { timeout: 5 },
    );
    expect(result.action).toBe('block');
    expect(result.reason).toContain('blocked');
  });

  it('returns allow on non-zero, non-2 exit codes (e.g. exit 1)', async () => {
    const runHook = await importRunHook();
    const result = await runHook('exit 1', { tool_name: 'Shell' }, { timeout: 5 });
    expect(result.action).toBe('allow');
  });

  it('returns allow with timedOut=true when the command exceeds the timeout', async () => {
    const runHook = await importRunHook();
    const result = await runHook('sleep 10', { tool_name: 'Shell' }, { timeout: 0.05 });
    expect(result.action).toBe('allow');
    expect(result.timedOut).toBe(true);
  });

  it('parses stdout JSON permissionDecision=deny into a block result with the supplied reason', async () => {
    const runHook = await importRunHook();
    const cmd =
      "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'use rg'}}))\"";
    const result = await runHook(cmd, { tool_name: 'Bash' }, { timeout: 5 });
    expect(result.action).toBe('block');
    expect(result.reason).toBe('use rg');
  });

  it('writes the input payload to the hook process stdin as JSON', async () => {
    const runHook = await importRunHook();
    const cmd =
      'node -e "let s=\\"\\";process.stdin.on(\\"data\\",d=>s+=d);process.stdin.on(\\"end\\",()=>{const o=JSON.parse(s);process.stdout.write(o.tool_name);})"';
    const result = await runHook(cmd, { tool_name: 'WriteFile' }, { timeout: 5 });
    expect(result.stdout?.trim()).toBe('WriteFile');
  });

  // Asserting on pwsh's own output would tie this test to PowerShell being installed
  // and to its cold start fitting inside the hook budget -- on a loaded CI runner the
  // budget expired, `runHook` returned allow with empty streams, and the assertion
  // failed with a bare "expected false to be true". Widening it to accept the timeout
  // would have made it vacuous: a runner that ignored `shell` entirely would pass.
  // The contract worth asserting is the spawn itself, which is deterministic.
  it('uses a non-interactive PowerShell process when requested', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockClear();

    const runHook = await importRunHook();
    await runHook(`Write-Output 'ok'`, {}, { timeout: 5, shell: 'powershell' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[0]).toBe(
      process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    );
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Write-Output 'ok'`,
    ]);
  }, 30_000);
});

// Regression coverage for the "every hook flashes an empty console window on
// Windows" bug. With `shell:true` and no `windowsHide`, Node allocates a
// visible console for each hook child process on Windows. The fix is to pass
// `windowsHide:true` (mirrors KAOS' `buildLocalSpawnOptions` and the runner's
// own taskkill spawn). The flag is only observable on Windows, so we assert
// the spawn options builder directly.
describe('buildHookSpawnOptions (Windows console-window regression)', () => {
  it('sets windowsHide:true so hooks do not flash a console on Windows', () => {
    expect(buildHookSpawnOptions({}).windowsHide).toBe(true);
  });

  it('runs through the shell with stdio piped', () => {
    const options = buildHookSpawnOptions({});
    expect(options.shell).toBe(true);
    expect(options.stdio).toBe('pipe');
  });

  it('merges hook env onto process.env and forwards cwd', () => {
    const options = buildHookSpawnOptions({ cwd: '/repo', env: { FOO: 'bar' } });
    expect(options.cwd).toBe('/repo');
    expect(options.env).toMatchObject({ FOO: 'bar' });
  });
});
