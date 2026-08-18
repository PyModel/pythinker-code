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
  // Micro compaction has been disabled and removed: the capability cannot be
  // enabled via env, config, or the master experimental switch. The entry is
  // kept here commented out so it can be restored if the feature is revived.
  // {
  //   id: 'micro_compaction',
  //   title: 'Micro compaction',
  //   description: 'Trim older large tool results from context while keeping recent conversation intact.',
  //   env: 'PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION',
  //   default: false,
  //   surface: 'core',
  // },
  {
    id: 'tool-select',
    title: 'Tool select (progressive tool disclosure)',
    description:
      'Keep MCP tool schemas out of the immutable top-level tools[]; the model loads them on demand via the select_tools tool. Only takes effect on models whose capability catalog declares dynamically loaded tools.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_TOOL_SELECT',
    default: false,
    surface: 'core',
  },
  {
    id: 'secondary-model',
    title: 'Secondary model for subagents',
    description:
      'Let newly spawned subagents use a separately configured secondary model by default, with an explicit primary-model override for quality-sensitive tasks.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_SECONDARY_MODEL',
    default: false,
    surface: 'core',
  },
  {
    id: 'acp-v2',
    title: 'ACP server v2 (agent-core-v2 engine)',
    description:
      'Expose the `pythinker acp-v2` sub-command that runs the Agent Client Protocol server over the experimental agent-core-v2 engine.',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_ACP_V2',
    default: false,
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
