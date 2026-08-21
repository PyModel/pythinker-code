// apps/pythinker-web/src/components/chat/tool-calls/toolRegistry.ts
import type { Component } from 'vue';
import type { ToolCall } from '../../../types';
import { normalizeToolName } from '../../../lib/toolMeta';
import AgentTool from './AgentTool.vue';
import AskUserTool from './AskUserTool.vue';
import BashTool from './BashTool.vue';
import EditTool from './EditTool.vue';
import GenericTool from './GenericTool.vue';
import GlobTool from './GlobTool.vue';
import GoalTool from './GoalTool.vue';
import GrepTool from './GrepTool.vue';
import MediaTool from './MediaTool.vue';
import DynamicWorkflowTool from './DynamicWorkflowTool.vue';
import PlanTool from './PlanTool.vue';
import ReadTool from './ReadTool.vue';
import TodoTool from './TodoTool.vue';
import WaitForTool from './WaitForTool.vue';
import WebFetchTool from './WebFetchTool.vue';

type ToolRenderer = Component;

/** Pick the renderer for a tool call. */
export function resolveToolRenderer(tool: ToolCall): ToolRenderer {
  if (tool.media && tool.status === 'ok') return MediaTool;
  const name = normalizeToolName(tool.name);
  if (name === 'bash') return BashTool;
  if (name === 'read') return ReadTool;
  if (name === 'edit' || name === 'write' || name === 'multi_edit') return EditTool;
  if (name === 'grep' || name === 'search') return GrepTool;
  if (name === 'glob' || name === 'ls') return GlobTool;
  if (name === 'web_fetch') return WebFetchTool;
  if (name === 'waitfor') return WaitForTool;
  if (name === 'todo') return TodoTool;
  // NOTE: normalizeToolName() folds `agent`/`subagent` into the canonical
  // `task` kind (see lib/toolMeta.ts NAME_ALIASES), so the match must be on
  // `task` — `agent` here would be dead code and route subagent calls to
  // GenericTool, dropping the inline "Open" button for the detail panel.
  if (name === 'task') return AgentTool;
  if (name === 'agentdynamic_workflow') return DynamicWorkflowTool;
  if (name === 'askuserquestion') return AskUserTool;
  if (name === 'exitplanmode') return PlanTool;
  if (name === 'creategoal' || name === 'getgoal' || name === 'setgoalbudget' || name === 'updategoal') return GoalTool;
  return GenericTool;
}
