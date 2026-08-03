import type { AutocompleteItem } from '@earendil-works/pi-tui';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import type { PythinkerSlashCommand, SlashCommandAvailability } from './types';

/** Subcommands offered when autocompleting `/goal <…>`. */
const GOAL_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'status', description: 'Show the current goal' },
  { value: 'pause', description: 'Pause the active goal' },
  { value: 'resume', description: 'Resume a paused goal' },
  { value: 'cancel', description: 'Cancel and remove the current goal' },
  { value: 'replace', description: 'Replace the current goal with a new objective' },
  { value: 'next', description: 'Queue an upcoming goal' },
];

const GOAL_NEXT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'manage', description: 'Manage upcoming goals' },
];

const DYNAMIC_WORKFLOW_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Turn Dynamic Workflow mode on' },
  { value: 'off', description: 'Turn Dynamic Workflow mode off' },
];

const FAST_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Turn Fast mode on' },
  { value: 'off', description: 'Turn Fast mode off' },
  { value: 'status', description: 'Show Fast mode status' },
];

const COLORS_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Keep rainbow colors on' },
  { value: 'off', description: 'Turn rainbow colors off' },
];

const PLUGIN_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List installed plugins' },
  { value: 'install', description: 'Install a plugin from a path or ZIP URL' },
  { value: 'marketplace', description: 'Browse the plugin marketplace' },
  { value: 'info', description: 'Show details for one plugin' },
  { value: 'enable', description: 'Enable a plugin' },
  { value: 'disable', description: 'Disable a plugin' },
  { value: 'remove', description: 'Remove a plugin from the session' },
  { value: 'reload', description: 'Reload plugins in the current session' },
  { value: 'mcp', description: 'Manage plugin-declared MCP servers' },
];

const PLUGIN_MCP_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'enable', description: 'Enable one plugin MCP server' },
  { value: 'disable', description: 'Disable one plugin MCP server' },
];

/** Argument autocompletion for the `/goal` command (subcommands). */
export function goalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const nextMatch = argumentPrefix.match(/^next\s+(\S*)$/i);
  if (nextMatch !== null) {
    return (
      completeLeadingArg(GOAL_NEXT_ARG_COMPLETIONS, nextMatch[1] ?? '')?.map((item) => ({
        ...item,
        value: `next ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(GOAL_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/workflow` command (subcommands). */
export function dynamicWorkflowArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(DYNAMIC_WORKFLOW_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/fast` command. */
export function fastArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(FAST_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/colors` command. */
export function colorsArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(COLORS_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/plugins` command (subcommands). */
export function pluginsArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const mcpMatch = argumentPrefix.match(/^mcp\s+(\S*)$/i);
  if (mcpMatch !== null) {
    return (
      completeLeadingArg(PLUGIN_MCP_ARG_COMPLETIONS, mcpMatch[1] ?? '')?.map((item) => ({
        ...item,
        value: `mcp ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(PLUGIN_ARG_COMPLETIONS, argumentPrefix);
}

export const BUILTIN_SLASH_COMMANDS = [
  {
    name: 'colors',
    aliases: [],
    description: 'Animate or toggle rainbow colors',
    priority: 100,
    completeArgs: colorsArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'yolo',
    aliases: ['yes'],
    description: 'Toggle YOLO mode: auto-approve tool actions, but the agent may still ask questions.',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'auto',
    aliases: [],
    description: 'Toggle Auto mode: fully autonomous, agent decides everything without asking.',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'permission',
    aliases: [],
    description: 'Select permission mode',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'permissions',
    aliases: ['allowed-tools'],
    description: 'Manage allow, ask, and deny permission rules',
    priority: 100,
    availability: 'idle-only',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Open TUI settings',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'privacy-settings',
    aliases: [],
    description: 'View or update telemetry privacy settings',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Toggle plan mode',
    priority: 100,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'workflow',
    aliases: [],
    description: 'Toggle Dynamic Workflow or run a task in parallel',
    priority: 100,
    completeArgs: dynamicWorkflowArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'model',
    aliases: [],
    description: 'Switch LLM model',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'effort',
    aliases: [],
    description: 'Set thinking effort for the current model',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'fast',
    aliases: [],
    description: 'Toggle provider-native Fast mode',
    priority: 100,
    completeArgs: fastArgumentCompletions,
    availability: (args) => args.trim().toLowerCase() === 'status' ? 'always' : 'idle-only',
  },
  {
    name: 'provider',
    aliases: ['providers'],
    description: 'Manage AI providers (add / delete / refresh)',
    priority: 95,
    availability: 'always',
  },
  {
    name: 'btw',
    aliases: [],
    description: 'Ask a forked side agent a question',
    priority: 90,
    availability: 'always',
  },
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands and shortcuts',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'new',
    aliases: ['clear', 'reset'],
    description: 'Start a fresh session in the current workspace',
    priority: 80,
  },
  {
    name: 'sessions',
    aliases: ['resume', 'continue'],
    description: 'Browse and resume sessions',
    priority: 80,
  },
  {
    name: 'tasks',
    aliases: ['task', 'bashes'],
    description: 'Browse background tasks',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'mcp',
    aliases: [],
    description: 'Show MCP server status',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'files',
    aliases: [],
    description: 'List files currently loaded in context',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'hooks',
    aliases: [],
    description: 'View configured hooks',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'doctor',
    aliases: [],
    description: 'Check configuration and keybindings',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'debug',
    aliases: [],
    description: 'Analyze the current session diagnostic log',
    priority: 60,
  },
  {
    name: 'heapdump',
    aliases: [],
    description: 'Dump the JavaScript heap to ~/Desktop',
    priority: 60,
    availability: 'always',
    hidden: true,
  },
  {
    name: 'plugins',
    aliases: ['plugin'],
    description: 'Manage plugins',
    priority: 60,
    completeArgs: pluginsArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'reload-plugins',
    aliases: [],
    description: 'Activate plugin changes in the current session',
    priority: 60,
    availability: 'idle-only',
  },
  {
    name: 'skills',
    aliases: [],
    description: 'List available skills',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'agents',
    aliases: [],
    description: 'Browse resolved agent profiles',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'experiments',
    aliases: ['experimental'],
    description: 'Manage experimental features',
    priority: 60,
    availability: 'idle-only',
  },
  {
    name: 'reload',
    aliases: [],
    description: 'Reload session and apply config.toml settings plus tui.toml UI preferences',
    priority: 60,
    availability: 'idle-only',
  },
  {
    name: 'reload-tui',
    aliases: [],
    description: 'Reload only tui.toml UI preferences',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'release-notes',
    aliases: [],
    description: 'View release notes',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'review',
    aliases: [],
    description: 'Review a pull request',
    priority: 60,
  },
  {
    name: 'security-review',
    aliases: [],
    description: 'Review branch changes for security vulnerabilities',
    priority: 60,
  },
  {
    name: 'pr-comments',
    aliases: [],
    description: 'Show GitHub pull request comments',
    priority: 60,
  },
  {
    name: 'commit',
    aliases: [],
    description: 'Create a git commit',
    priority: 60,
  },
  {
    name: 'commit-push-pr',
    aliases: [],
    description: 'Commit, push, and open a pull request',
    priority: 60,
  },
  {
    name: 'compact',
    aliases: [],
    description: 'Compact the conversation context',
    priority: 80,
  },
  {
    name: 'copy',
    aliases: [],
    description: 'Copy a recent assistant response or code block',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'add-dir',
    aliases: [],
    description: 'Add another working directory',
    priority: 80,
    availability: 'idle-only',
  },
  {
    name: 'goal',
    aliases: [],
    description: 'Start or manage an autonomous goal',
    priority: 80,
    // No argumentHint: the menu description stays as short as every other
    // command's. The subcommands (status/pause/resume/cancel/replace) surface in
    // the argument autocomplete list once the user types `/goal ` (see
    // completeArgs), so they don't need to be spelled out inline.
    completeArgs: goalArgumentCompletions,
    // status / pause / cancel are always available; creation, replacement, and
    // resume start (or restart) a turn and so are idle-only.
    availability: (args) => {
      const trimmed = args.trim();
      if (trimmed === 'next' || trimmed.startsWith('next ')) return 'always';
      return trimmed === '' || trimmed === 'status' || trimmed === 'pause' || trimmed === 'cancel'
        ? 'always'
        : 'idle-only';
    },
  },
  {
    name: 'init',
    aliases: [],
    description: 'Analyze the codebase and generate AGENTS.md',
  },
  {
    name: 'init-verifiers',
    aliases: [],
    description: 'Create functional verifier skills for this project',
    priority: 60,
  },
  {
    name: 'fork',
    aliases: ['branch'],
    description: 'Fork the current session',
    priority: 80,
  },
  {
    name: 'title',
    aliases: ['rename'],
    description: 'Set or show session title',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'usage',
    aliases: [],
    description: 'Show session tokens + context window + plan quotas',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'cost',
    aliases: [],
    description: 'Show session spend and current model token rates',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'context',
    aliases: [],
    description: 'Show what is using the model context window',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'memory',
    aliases: [],
    description: 'Edit user or project memory',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'diff',
    aliases: [],
    description: 'Inspect uncommitted working-tree changes',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'status',
    aliases: [],
    description: 'Show current session and runtime status',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'tag',
    aliases: [],
    description: 'Toggle a searchable tag on the current session',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'feedback',
    aliases: ['bug'],
    description: 'Send feedback to make Pythinker Code better',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'undo',
    aliases: ['rewind'],
    description: 'Withdraw the last prompt from the transcript',
    priority: 80,
    availability: 'idle-only',
  },
  {
    name: 'editor',
    aliases: [],
    description: 'Set the external editor for Ctrl-G',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'keybindings',
    aliases: [],
    description: 'Open or create the keybindings configuration',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'terminal-setup',
    aliases: [],
    description: 'Check multiline input support',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'theme',
    aliases: [],
    description: 'Set the terminal UI theme',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'vim',
    aliases: [],
    description: 'Toggle between Vim and normal editing modes',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'output-style',
    aliases: ['outputstyle'],
    description: 'Set the response output style',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'logout',
    aliases: ['disconnect'],
    description: 'Log out of a configured provider',
    priority: 40,
  },
  {
    name: 'login',
    aliases: ['connect'],
    description: 'Select a platform and authenticate',
    priority: 40,
  },
  {
    name: 'export-md',
    aliases: ['export'],
    description: 'Export current session as a Markdown file',
    priority: 40,
  },
  {
    name: 'export-debug-zip',
    aliases: [],
    description: 'Export current session as a debug ZIP archive',
    priority: 40,
  },
  {
    name: 'web',
    aliases: [],
    description: 'Open the current session in the Web UI and exit the terminal',
    priority: 40,
    availability: 'always',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the application',
    priority: 20,
  },
  {
    name: 'version',
    aliases: [],
    description: 'Show version information',
    priority: 20,
    availability: 'always',
  },
] as const satisfies readonly PythinkerSlashCommand[];

export type BuiltinSlashCommand = (typeof BUILTIN_SLASH_COMMANDS)[number];
export type BuiltinSlashCommandName = BuiltinSlashCommand['name'];

export function findBuiltInSlashCommand(commandName: string): BuiltinSlashCommand | undefined {
  const commands = BUILTIN_SLASH_COMMANDS as readonly PythinkerSlashCommand<BuiltinSlashCommandName>[];
  return commands.find(
    (command) => command.name === commandName || command.aliases.includes(commandName),
  ) as BuiltinSlashCommand | undefined;
}

export function resolveSlashCommandAvailability(
  command: PythinkerSlashCommand,
  args: string,
): SlashCommandAvailability {
  const availability = command.availability ?? 'idle-only';
  return typeof availability === 'function' ? availability(args) : availability;
}

export function sortSlashCommands(commands: readonly PythinkerSlashCommand[]): PythinkerSlashCommand[] {
  return [...commands].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );
}
