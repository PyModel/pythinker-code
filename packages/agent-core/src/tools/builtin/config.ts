import { z } from 'zod';

import type { Agent } from '../../agent';
import type { BuiltinTool } from '../../agent/tool';
import type { PythinkerConfig, PythinkerConfigPatch } from '../../config';
import type { ExecutableToolResult, ToolExecution } from '../../loop/types';
import { errorMessage } from '../../loop/errors';
import { toInputJsonSchema } from '../support/input-schema';
import DESCRIPTION from './config.md?raw';

export interface ConfigStore {
  get(): Promise<PythinkerConfig>;
  set(patch: PythinkerConfigPatch): Promise<PythinkerConfig>;
}

type ConfigValue = string | boolean | number;

interface ConfigSetting {
  readonly path: readonly string[];
  readonly type: 'string' | 'boolean' | 'number';
  readonly options?: readonly string[];
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
}

const CONFIG_SETTINGS: Readonly<Record<string, ConfigSetting>> = {
  model: { path: ['defaultModel'], type: 'string' },
  'permissions.defaultMode': {
    path: ['defaultPermissionMode'],
    type: 'string',
    options: ['yolo', 'manual', 'auto'],
  },
  alwaysThinkingEnabled: { path: ['defaultThinking'], type: 'boolean' },
  defaultPlanMode: { path: ['defaultPlanMode'], type: 'boolean' },
  mergeAllAvailableSkills: { path: ['mergeAllAvailableSkills'], type: 'boolean' },
  telemetry: { path: ['telemetry'], type: 'boolean' },
  'background.maxRunningTasks': {
    path: ['background', 'maxRunningTasks'],
    type: 'number',
    integer: true,
    min: 1,
  },
  'background.keepAliveOnExit': {
    path: ['background', 'keepAliveOnExit'],
    type: 'boolean',
  },
  'background.killGracePeriodMs': {
    path: ['background', 'killGracePeriodMs'],
    type: 'number',
    integer: true,
    min: 0,
  },
  'background.printWaitCeilingS': {
    path: ['background', 'printWaitCeilingS'],
    type: 'number',
    integer: true,
    min: 1,
  },
  'loopControl.maxStepsPerTurn': {
    path: ['loopControl', 'maxStepsPerTurn'],
    type: 'number',
    integer: true,
    min: 0,
  },
  'loopControl.maxRetriesPerStep': {
    path: ['loopControl', 'maxRetriesPerStep'],
    type: 'number',
    integer: true,
    min: 0,
  },
  'loopControl.maxRalphIterations': {
    path: ['loopControl', 'maxRalphIterations'],
    type: 'number',
    integer: true,
    min: -1,
  },
  'loopControl.reservedContextSize': {
    path: ['loopControl', 'reservedContextSize'],
    type: 'number',
    integer: true,
    min: 0,
  },
  'loopControl.compactionTriggerRatio': {
    path: ['loopControl', 'compactionTriggerRatio'],
    type: 'number',
    min: 0.5,
    max: 0.99,
  },
  'experimental.micro_compaction': {
    path: ['experimental', 'micro_compaction'],
    type: 'boolean',
  },
  'experimental.vim_mode': {
    path: ['experimental', 'vim_mode'],
    type: 'boolean',
  },
  'experimental.agent_fork_context': {
    path: ['experimental', 'agent_fork_context'],
    type: 'boolean',
  },
  'experimental.task_graph': {
    path: ['experimental', 'task_graph'],
    type: 'boolean',
  },
  'experimental.agent_teams': {
    path: ['experimental', 'agent_teams'],
    type: 'boolean',
  },
  'experimental.worktree_mode': {
    path: ['experimental', 'worktree_mode'],
    type: 'boolean',
  },
  'experimental.powershell': {
    path: ['experimental', 'powershell'],
    type: 'boolean',
  },
  'experimental.lsp': {
    path: ['experimental', 'lsp'],
    type: 'boolean',
  },
};

export const ConfigInputSchema = z.object({
  setting: z.string().min(1).describe('Supported Pythinker Code setting key.'),
  value: z
    .union([z.string(), z.boolean(), z.number()])
    .optional()
    .describe('New value. Omit to read the current value.'),
}).strict();

export type ConfigInput = z.infer<typeof ConfigInputSchema>;

interface ConfigOutput {
  readonly success: boolean;
  readonly operation?: 'get' | 'set';
  readonly setting?: string;
  readonly value?: unknown;
  readonly previousValue?: unknown;
  readonly newValue?: unknown;
  readonly error?: string;
}

export class ConfigTool implements BuiltinTool<ConfigInput> {
  readonly name = 'Config' as const;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ConfigInputSchema);

  constructor(
    private readonly store: ConfigStore,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: ConfigInput): ToolExecution {
    const operation = args.value === undefined ? 'Reading' : 'Setting';
    return {
      description: `${operation} config ${args.setting}`,
      approvalRule: this.name,
      execute: () => this.execute(args),
    };
  }

  private async execute(args: ConfigInput): Promise<ExecutableToolResult> {
    const setting = CONFIG_SETTINGS[args.setting];
    if (setting === undefined) {
      return output({ success: false, error: `Unknown setting: "${args.setting}"` });
    }

    try {
      const config = await this.store.get();
      const previousValue = getPath(config, setting.path);
      if (args.value === undefined) {
        return output({
          success: true,
          operation: 'get',
          setting: args.setting,
          value: previousValue,
        });
      }

      const normalized = normalizeValue(args.setting, args.value, setting);
      if (typeof normalized === 'string') {
        return output({
          success: false,
          operation: 'set',
          setting: args.setting,
          error: normalized,
        });
      }

      if (args.setting === 'model') {
        this.agent.modelProvider?.resolveProviderConfig(String(normalized.value));
      }

      await this.store.set(buildPatch(setting.path, normalized.value));
      if (args.setting === 'model') {
        await this.agent.rpcMethods.setModel({ model: String(normalized.value) });
      } else if (args.setting === 'alwaysThinkingEnabled') {
        await this.agent.rpcMethods.setThinking({
          level: normalized.value === true ? 'on' : 'off',
        });
      }

      return output({
        success: true,
        operation: 'set',
        setting: args.setting,
        previousValue,
        newValue: normalized.value,
      });
    } catch (error) {
      return output({
        success: false,
        operation: args.value === undefined ? 'get' : 'set',
        setting: args.setting,
        error: errorMessage(error),
      });
    }
  }
}

function normalizeValue(
  name: string,
  value: ConfigValue,
  setting: ConfigSetting,
): { readonly value: ConfigValue } | string {
  if (setting.type === 'boolean') {
    const normalized =
      typeof value === 'string'
        ? value.trim().toLowerCase() === 'true'
          ? true
          : value.trim().toLowerCase() === 'false'
            ? false
            : value
        : value;
    return typeof normalized === 'boolean'
      ? { value: normalized }
      : `${name} requires true or false.`;
  }

  if (setting.type === 'string') {
    if (typeof value !== 'string') return `${name} requires a string.`;
    if (setting.options !== undefined && !setting.options.includes(value)) {
      return `Invalid value "${value}". Options: ${setting.options.join(', ')}`;
    }
    return { value };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${name} requires a number.`;
  }
  if (setting.integer === true && !Number.isInteger(value)) {
    return `${name} requires an integer.`;
  }
  if (setting.min !== undefined && value < setting.min) {
    return `${name} must be at least ${String(setting.min)}.`;
  }
  if (setting.max !== undefined && value > setting.max) {
    return `${name} must be at most ${String(setting.max)}.`;
  }
  return { value };
}

function getPath(config: PythinkerConfig, path: readonly string[]): unknown {
  let value: unknown = config;
  for (const segment of path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function buildPatch(path: readonly string[], value: ConfigValue): PythinkerConfigPatch {
  const root: Record<string, unknown> = {};
  let current = root;
  for (let index = 0; index < path.length - 1; index++) {
    const child: Record<string, unknown> = {};
    current[path[index]!] = child;
    current = child;
  }
  current[path.at(-1)!] = value;
  return root as PythinkerConfigPatch;
}

function output(result: ConfigOutput): ExecutableToolResult {
  return { output: JSON.stringify(result) };
}
