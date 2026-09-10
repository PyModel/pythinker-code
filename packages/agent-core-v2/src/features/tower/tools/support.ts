import {
  GitError,
  TowerProtocolError,
  TowerStore,
  resolveTowerRepoRoot,
  type TowerState,
} from '#/features/tower/protocol/index';
import type { ISessionContext } from '#/session/sessionContext/sessionContext';
import type { ExecutableToolResult } from '#/tool/toolContract';

export function newTowerStore(sessionContext: ISessionContext): TowerStore {
  return new TowerStore(resolveTowerRepoRoot(sessionContext.cwd));
}

export const TOWER_MAIN_AGENT_ONLY =
  'Tower orchestration tools are only supported by the main agent.';

export const TOWER_BUILD_MISSION_NEEDS_TASKS =
  'Every build mission needs at least one non-empty task — the reviewer maps each task to the diff. ' +
  'Add tasks, or use kind="survey" for a read-only investigation that needs no checklist.';

export const TOWER_MODE_USER_ENABLED_ONLY =
  'tower mode is not active — only the user can enable it (with /tower on), never the agent. ' +
  'Ask the user to turn tower mode on, then drive the tower protocol.';

export function callerName(agentId: string, store: TowerStore, state: TowerState): string {
  return store.resolveCallerName(state, agentId);
}

export async function runTowerTool(
  execute: () => Promise<ExecutableToolResult>,
): Promise<ExecutableToolResult> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof TowerProtocolError || error instanceof GitError) {
      return { output: error.message, isError: true };
    }
    throw error;
  }
}
