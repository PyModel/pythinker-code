import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  mergeConfigPatch,
  type PythinkerConfig,
  type PythinkerConfigPatch,
} from '../../src/config';
import {
  ConfigTool,
  type ConfigStore,
} from '../../src/tools/builtin/config';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function makeTool(initial: PythinkerConfig = { providers: {} }): {
  tool: ConfigTool;
  set: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
} {
  let config = initial;
  const set = vi.fn(async (patch: PythinkerConfigPatch) => {
    config = mergeConfigPatch(config, patch);
    return config;
  });
  const store: ConfigStore = {
    get: async () => config,
    set,
  };
  const setModel = vi.fn();
  const agent = {
    rpcMethods: { setModel },
    modelProvider: { resolveProviderConfig: vi.fn(() => ({})) },
  } as unknown as Agent;
  return { tool: new ConfigTool(store, agent), set, setModel };
}

async function run(tool: ConfigTool, args: { setting: string; value?: string | boolean | number }) {
  return executeTool(tool, {
    turnId: '0',
    toolCallId: 'call_config',
    args,
    signal,
  });
}

function parseOutput(output: unknown): Record<string, unknown> {
  if (typeof output !== 'string') throw new TypeError('Expected text tool output');
  return JSON.parse(output) as Record<string, unknown>;
}

describe('ConfigTool', () => {
  it('gets a supported setting without writing', async () => {
    const { tool, set } = makeTool({
      providers: {},
      defaultPermissionMode: 'manual',
    });

    const result = await run(tool, { setting: 'permissions.defaultMode' });

    expect(parseOutput(result.output)).toEqual({
      success: true,
      operation: 'get',
      setting: 'permissions.defaultMode',
      value: 'manual',
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('coerces boolean strings and writes a scoped patch', async () => {
    const { tool, set } = makeTool({ providers: {}, telemetry: true });

    const result = await run(tool, { setting: 'telemetry', value: 'false' });

    expect(set).toHaveBeenCalledWith({ telemetry: false });
    expect(parseOutput(result.output)).toEqual({
      success: true,
      operation: 'set',
      setting: 'telemetry',
      previousValue: true,
      newValue: false,
    });
  });

  it('writes nested numeric settings without replacing sibling config', async () => {
    const { tool, set } = makeTool({
      providers: {},
      background: { keepAliveOnExit: true },
    });

    await run(tool, { setting: 'background.maxRunningTasks', value: 3 });

    expect(set).toHaveBeenCalledWith({
      background: { maxRunningTasks: 3 },
    });
  });

  it('validates setting names, options, and numeric ranges before writing', async () => {
    const { tool, set } = makeTool();

    const unknown = await run(tool, { setting: 'theme', value: 'dark' });
    const option = await run(tool, {
      setting: 'permissions.defaultMode',
      value: 'dangerously-auto',
    });
    const range = await run(tool, {
      setting: 'background.maxRunningTasks',
      value: 0,
    });

    expect(parseOutput(unknown.output)).toMatchObject({
      success: false,
      error: 'Unknown setting: "theme"',
    });
    expect(parseOutput(option.output)).toMatchObject({
      success: false,
      error: expect.stringContaining('Options: yolo, manual, auto'),
    });
    expect(parseOutput(range.output)).toMatchObject({
      success: false,
      error: expect.stringContaining('must be at least 1'),
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('updates the active model after persisting the default', async () => {
    const { tool, set, setModel } = makeTool();

    const result = await run(tool, { setting: 'model', value: 'example-model' });

    expect(set).toHaveBeenCalledWith({ defaultModel: 'example-model' });
    expect(setModel).toHaveBeenCalledWith({ model: 'example-model' });
    expect(parseOutput(result.output)).toMatchObject({
      success: true,
      newValue: 'example-model',
    });
  });
});
