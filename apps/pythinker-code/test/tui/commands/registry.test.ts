import {
  BUILTIN_SLASH_COMMANDS,
  colorsArgumentCompletions,
  fastArgumentCompletions,
  findBuiltInSlashCommand,
  parseSlashInput,
  pluginsArgumentCompletions,
  resolveSlashCommandAvailability,
  sortSlashCommands,
  dynamicWorkflowArgumentCompletions,
  type PythinkerSlashCommand,
} from '#/tui/commands/index';
import { describe, expect, it } from 'vitest';

describe('parseSlashInput', () => {
  it('parses command names and trimmed args', () => {
    expect(parseSlashInput('/help')).toEqual({ name: 'help', args: '' });
    expect(parseSlashInput('/model   pythinker-k2  ')).toEqual({
      name: 'model',
      args: 'pythinker-k2',
    });
  });

  it('returns null for non-commands and path-like input', () => {
    expect(parseSlashInput('hello')).toBeNull();
    expect(parseSlashInput('/')).toBeNull();
    expect(parseSlashInput('/   ')).toBeNull();
    expect(parseSlashInput('/some/path')).toBeNull();
    expect(parseSlashInput('/some/path with args')).toBeNull();
  });
});

describe('built-in slash command registry', () => {
  it('finds built-ins by name or alias', () => {
    expect(findBuiltInSlashCommand('exit')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('quit')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('q')?.name).toBe('exit');
    expect(findBuiltInSlashCommand('clear')?.name).toBe('new');
    expect(findBuiltInSlashCommand('reset')?.name).toBe('new');
    expect(findBuiltInSlashCommand('continue')?.name).toBe('sessions');
    expect(findBuiltInSlashCommand('bashes')?.name).toBe('tasks');
    expect(findBuiltInSlashCommand('btw')?.name).toBe('btw');
    expect(findBuiltInSlashCommand('mcp')?.name).toBe('mcp');
    expect(findBuiltInSlashCommand('connect')?.name).toBe('login');
    expect(findBuiltInSlashCommand('allowed-tools')?.name).toBe('permissions');
    expect(findBuiltInSlashCommand('plugin')?.name).toBe('plugins');
    expect(findBuiltInSlashCommand('update')?.name).toBe('update');
    expect(findBuiltInSlashCommand('upgrade')?.name).toBe('update');
    expect(findBuiltInSlashCommand('reload-plugins')?.name).toBe('reload-plugins');
    expect(findBuiltInSlashCommand('release-notes')?.name).toBe('release-notes');
    expect(findBuiltInSlashCommand('review')?.name).toBe('review');
    expect(findBuiltInSlashCommand('security-review')?.name).toBe('security-review');
    expect(findBuiltInSlashCommand('pr-comments')?.name).toBe('pr-comments');
    expect(findBuiltInSlashCommand('commit')?.name).toBe('commit');
    expect(findBuiltInSlashCommand('commit-push-pr')?.name).toBe('commit-push-pr');
    expect(findBuiltInSlashCommand('privacy-settings')?.name).toBe('privacy-settings');
    expect(findBuiltInSlashCommand('terminal-setup')?.name).toBe('terminal-setup');
    expect(findBuiltInSlashCommand('init-verifiers')?.name).toBe('init-verifiers');
    expect((findBuiltInSlashCommand('heapdump') as PythinkerSlashCommand | undefined)?.hidden).toBe(
      true,
    );
    expect(findBuiltInSlashCommand('bug')?.name).toBe('feedback');
    expect(findBuiltInSlashCommand('status')?.name).toBe('status');
    expect(findBuiltInSlashCommand('cost')?.name).toBe('cost');
    expect(findBuiltInSlashCommand('usage')?.aliases).not.toContain('status');
    const colors = findBuiltInSlashCommand('colors');
    expect(colors?.name).toBe('colors');
    expect(colors?.aliases).toEqual([]);
    expect(resolveSlashCommandAvailability(colors!, '')).toBe('always');
    expect(findBuiltInSlashCommand('dance')).toBeUndefined();
    expect(findBuiltInSlashCommand('unknown')).toBeUndefined();
  });

  it('offers colors mode argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = colorsArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off']);
    expect(values('O')).toEqual(['on', 'off']);
    expect(colorsArgumentCompletions('of')).toEqual([
      { value: 'off', label: 'off', description: 'Turn rainbow colors off' },
    ]);
    expect(values('on')).toBeNull();
    expect(values('off')).toBeNull();
    expect(values('unknown')).toBeNull();
  });

  it('offers Fast mode completions and keeps status available while busy', () => {
    const fast = findBuiltInSlashCommand('fast');
    expect(fast).toBeDefined();
    expect(resolveSlashCommandAvailability(fast!, '')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(fast!, 'on')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(fast!, 'off')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(fast!, 'status')).toBe('always');
    expect(fastArgumentCompletions('')).toEqual([
      { value: 'on', label: 'on', description: 'Turn Fast mode on' },
      { value: 'off', label: 'off', description: 'Turn Fast mode off' },
      { value: 'status', label: 'status', description: 'Show Fast mode status' },
    ]);
  });
  it('keeps advisor status and the omitted verb available while busy', () => {
    const advisor = findBuiltInSlashCommand('advisor');
    expect(advisor).toBeDefined();
    expect(resolveSlashCommandAvailability(advisor!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(advisor!, 'status')).toBe('always');
    expect(resolveSlashCommandAvailability(advisor!, 'on')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(advisor!, 'off')).toBe('idle-only');
  });


  it('marks plan clear as idle-only while normal plan toggles are always available', () => {
    const plan = findBuiltInSlashCommand('plan');
    expect(plan).toBeDefined();
    expect(resolveSlashCommandAvailability(plan!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'on')).toBe('always');
    expect(resolveSlashCommandAvailability(plan!, 'clear')).toBe('idle-only');
  });

  it('keeps Dynamic Workflow mode changes and tasks idle-only', () => {
    const workflow = findBuiltInSlashCommand('workflow');
    expect(workflow).toBeDefined();
    expect((workflow as PythinkerSlashCommand).experimentalFlag).toBeUndefined();
    expect(resolveSlashCommandAvailability(workflow!, 'on')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(workflow!, 'off')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(workflow!, 'Ship feature X')).toBe('idle-only');
  });

  it('offers Dynamic Workflow subcommand argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = dynamicWorkflowArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual(['on', 'off', 'model', 'save']);
    expect(values('O')).toEqual(['on', 'off']);
    expect(values('mod')).toEqual(['model']);
    expect(values('sa')).toEqual(['save']);
    expect(dynamicWorkflowArgumentCompletions('of')).toEqual([
      { value: 'off', label: 'off', description: 'Turn Dynamic Workflow mode off' },
    ]);
    expect(values('on')).toBeNull();
    expect(values('off')).toBeNull();
    expect(values('Ship feature X')).toBeNull();
  });

  it('offers plugin subcommand argument completions', () => {
    const values = (prefix: string): string[] | null => {
      const items = pluginsArgumentCompletions(prefix);
      return items === null ? null : items.map((item) => item.value);
    };

    expect(values('')).toEqual([
      'list',
      'install',
      'marketplace',
      'info',
      'enable',
      'disable',
      'remove',
      'reload',
      'mcp',
    ]);
    expect(values('ma')).toEqual(['marketplace']);
    expect(values('mcp e')).toEqual(['mcp enable']);
    expect(values('mcp d')).toEqual(['mcp disable']);
    expect(values('reload')).toBeNull();
  });

  it('defaults commands without explicit availability to idle-only', () => {
    const command: PythinkerSlashCommand = {
      name: 'example',
      aliases: [],
      description: 'Example command',
    };

    expect(resolveSlashCommandAvailability(command, '')).toBe('idle-only');
  });

  it('sorts commands by priority descending and name ascending', () => {
    const commands: PythinkerSlashCommand[] = [
      { name: 'zebra', aliases: [], description: 'Z', priority: 100 },
      { name: 'alpha', aliases: [], description: 'A', priority: 100 },
      { name: 'middle', aliases: [], description: 'M', priority: 50 },
      { name: 'plain', aliases: [], description: 'P' },
    ];

    expect(sortSlashCommands(commands).map((command) => command.name)).toEqual([
      'alpha',
      'zebra',
      'middle',
      'plain',
    ]);
  });

  it('registers goal with subcommand-aware availability', () => {
    const goal = findBuiltInSlashCommand('goal');
    expect(goal).toBeDefined();
    expect((goal as PythinkerSlashCommand).experimentalFlag).toBeUndefined();
    expect(resolveSlashCommandAvailability(goal!, '')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'status')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'pause')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'cancel')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next Ship feature Y')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'next manage')).toBe('always');
    expect(resolveSlashCommandAvailability(goal!, 'status report')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'pause the rollout')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'cancel the migration')).toBe('idle-only');
    // `clear` is no longer a subcommand; it parses as an objective -> idle-only.
    expect(resolveSlashCommandAvailability(goal!, 'clear')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'resume')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'Ship feature X')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(goal!, 'replace Ship feature Y')).toBe('idle-only');
  });

  it('contains the expected command names once', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'agents',
        'colors',
        'compact',
        'commit',
        'commit-push-pr',
        'copy',
        'cost',
        'btw',
        'debug',
        'doctor',
        'editor',
        'exit',
        'export-debug-zip',
        'fast',
        'fork',
        'help',
        'hooks',
        'heapdump',
        'init',
        'init-verifiers',
        'keybindings',
        'login',
        'logout',
        'mcp',
        'model',
        'new',
        'output-style',
        'permission',
        'permissions',
        'plan',
        'pr-comments',
        'privacy-settings',
        'reload',
        'reload-plugins',
        'reload-tui',
        'release-notes',
        'review',
        'security-review',
        'sessions',
        'settings',
        'skills',
        'status',
        'tag',
        'theme',
        'terminal-setup',
        'title',
        'undo',
        'usage',
        'version',
        'vim',
        'yolo',
      ]),
    );
  });

  it('keeps TUI reload always available and full reload idle-only', () => {
    const reload = findBuiltInSlashCommand('reload');
    const reloadTui = findBuiltInSlashCommand('reload-tui');

    expect(reload).toBeDefined();
    expect(reloadTui).toBeDefined();
    expect(resolveSlashCommandAvailability(reload!, '')).toBe('idle-only');
    expect(resolveSlashCommandAvailability(reloadTui!, '')).toBe('always');
  });
});
