import type { AgentMeta } from '#/session/sessionMetadata/sessionMetadata';

export function subagentLabels(
  parentAgentId: string,
  options: { readonly dynamic_workflowItem?: string } = {},
): Readonly<Record<string, string>> {
  const labels: Record<string, string> = { parentAgentId };
  if (options.dynamic_workflowItem !== undefined) {
    labels['dynamic_workflowItem'] = options.dynamic_workflowItem;
  }
  return labels;
}

export function labelsFromAgentMeta(
  meta: AgentMeta,
): Readonly<Record<string, string>> | undefined {
  const labels: Record<string, string> = { ...meta.labels };
  const parentAgentId = subagentParentAgentId(meta);
  if (parentAgentId !== undefined) {
    labels['parentAgentId'] = parentAgentId;
  }
  const dynamic_workflowItem = subagentDynamicWorkflowItem(meta);
  if (dynamic_workflowItem !== undefined) {
    labels['dynamic_workflowItem'] = dynamic_workflowItem;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

export function isSubagentMeta(meta: AgentMeta | undefined): boolean {
  if (meta === undefined) return false;
  if (subagentParentAgentId(meta) !== undefined) return true;
  return meta.type === 'sub';
}

export function subagentParentAgentId(meta: AgentMeta | undefined): string | undefined {
  if (meta === undefined) return undefined;
  return firstNonEmpty(meta.labels?.['parentAgentId'], meta.parentAgentId ?? undefined);
}

export function subagentDynamicWorkflowItem(meta: AgentMeta | undefined): string | undefined {
  if (meta === undefined) return undefined;
  return firstNonEmpty(meta.labels?.['dynamic_workflowItem'], meta.dynamic_workflowItem);
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}
