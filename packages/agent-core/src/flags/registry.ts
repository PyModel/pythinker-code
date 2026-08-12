import type { FlagDefinitionInput } from './types';

/**
 * Experimental feature flags.
 *
 * To add one, append an entry and gate runtime behavior through the scoped
 * resolver available on `PythinkerCore`, `Session`, or `Agent`:
 *   { id: 'my_feature', title: 'My feature', description: '...', env: 'PYTHINKER_CODE_EXPERIMENTAL_MY_FEATURE', default: false, surface: 'both' }
 *
 * Keep the `as const satisfies` — it derives the literal `FlagId` union that gives `enabled()`
 * autocomplete and typo-checking. `env` must start with 'PYTHINKER_CODE_EXPERIMENTAL_', be unique, and
 * not equal the master switch 'PYTHINKER_CODE_EXPERIMENTAL_FLAG'; `id` must not be 'flag'.
 */
export const FLAG_DEFINITIONS = [
  {
    id: 'micro_compaction',
    title: 'Micro compaction',
    description: 'Trim older large tool results from context while keeping recent conversation intact.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION',
    default: true,
    surface: 'core',
  },
  {
    id: 'tool_intent',
    title: 'Tool intent indicator',
    description: 'Ask the model to state a concise intent with each tool call and show it in the working indicator.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_TOOL_INTENT',
    default: true,
    surface: 'core',
  },
  {
    id: 'vim_mode',
    title: 'Vim mode',
    description: 'Modal editing in the composer: normal, insert, and visual modes with motions, operators, and dot-repeat.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_VIM_MODE',
    default: false,
    surface: 'tui',
  },
  {
    id: 'agent_fork_context',
    title: 'Agent context forks',
    description: 'Omitting subagent_type forks the parent conversation into a background worker.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_AGENT_FORK_CONTEXT',
    default: false,
    surface: 'core',
  },
  {
    id: 'task_graph',
    title: 'Project task graph',
    description: 'Enable persistent project tasks with ownership and dependency tracking.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_TASK_GRAPH',
    default: false,
    surface: 'core',
  },
  {
    id: 'agent_teams',
    title: 'Agent teams',
    description: 'Enable persistent named teams, teammate messaging, and teammate agent spawning.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_AGENT_TEAMS',
    default: false,
    surface: 'core',
  },
  {
    id: 'coordinator_mode',
    title: 'Coordinator mode',
    description: 'Boot the main agent with a worker-orchestration profile.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_COORDINATOR_MODE',
    default: false,
    surface: 'core',
  },
  {
    id: 'token_budget',
    title: 'Token target continuation',
    description: 'Continue explicit token-target prompts until the target or diminishing returns.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_TOKEN_BUDGET',
    default: false,
    surface: 'core',
  },
  {
    id: 'agent_memory',
    title: 'Agent memory',
    description: 'Enable project memory for the main agent and profile-scoped subagent memory.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_AGENT_MEMORY',
    default: false,
    surface: 'core',
  },
  {
    id: 'worktree_mode',
    title: 'Worktree mode',
    description: 'Allow an explicitly requested session to enter and exit an isolated Git worktree.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_WORKTREE_MODE',
    default: false,
    surface: 'core',
  },
  {
    id: 'powershell',
    title: 'PowerShell tool',
    description: 'Expose native non-interactive PowerShell command execution on Windows.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_POWERSHELL',
    default: false,
    surface: 'core',
  },
  {
    id: 'lsp',
    title: 'Language server tool',
    description: 'Enable plugin-configured Language Server Protocol code intelligence.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_LSP',
    default: false,
    surface: 'core',
  },
] as const satisfies readonly FlagDefinitionInput[];

/** Literal union of registered flag ids. */
export type FlagId = (typeof FLAG_DEFINITIONS)[number]['id'];
