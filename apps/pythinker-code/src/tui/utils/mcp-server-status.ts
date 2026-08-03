import type { McpServerInfo, McpServerStatusEvent } from '@pythoughts/pythinker-code-sdk';

import type { ColorToken } from '#/tui/theme';

export type McpServerStatusSnapshot = McpServerInfo | McpServerStatusEvent['server'];

export interface McpStartupStatusLine {
  readonly label: string;
  readonly color: ColorToken;
  readonly loading: boolean;
  readonly transient: boolean;
}

export function buildMcpStartupStatusLine(
  servers: readonly McpServerStatusSnapshot[],
): McpStartupStatusLine | null {
  const enabled = servers.filter((server) => server.status !== 'disabled');
  if (enabled.length === 0) return null;

  const connected = enabled.filter((server) => server.status === 'connected');
  const failed = enabled.filter((server) => server.status === 'failed').length;
  const needsAuth = enabled.filter((server) => server.status === 'needs-auth').length;
  const loading = enabled.filter((server) => server.status === 'pending').length;
  const parts = [`${String(connected.length)}/${String(enabled.length)} connected`];

  if (failed > 0) parts.push(`${String(failed)} failed`);
  if (needsAuth > 0) parts.push(`${String(needsAuth)} needs auth`);
  if (loading > 0) parts.push(`${String(loading)} loading…`);

  const hasIssues = failed > 0 || needsAuth > 0;
  if (loading === 0 && hasIssues) parts.push('/mcp for details');
  if (loading === 0 && !hasIssues) {
    const tools = connected.reduce((sum, server) => sum + server.toolCount, 0);
    parts.push(`${String(tools)} tool${tools === 1 ? '' : 's'}`);
  }

  return {
    label: `MCP servers · ${parts.join(' · ')}`,
    color: failed > 0
      ? 'error'
      : needsAuth > 0
        ? 'warning'
        : loading > 0
          ? 'primary'
          : 'success',
    loading: loading > 0,
    transient: loading === 0 && !hasIssues,
  };
}

export function formatMcpStartupStatusSummary(
  servers: readonly McpServerStatusSnapshot[],
): string {
  let failed = 0;
  let needsAuth = 0;
  let connecting = 0;
  let connected = 0;
  let disabled = 0;
  for (const server of servers) {
    switch (server.status) {
      case 'failed':
        failed++;
        break;
      case 'needs-auth':
        needsAuth++;
        break;
      case 'pending':
        connecting++;
        break;
      case 'connected':
        connected++;
        break;
      case 'disabled':
        disabled++;
        break;
    }
  }

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} failed`);
  if (needsAuth > 0) parts.push(`${needsAuth} need auth`);
  if (connecting > 0) parts.push(`${connecting} connecting`);
  if (connected > 0) parts.push(`${connected} connected`);
  if (disabled > 0) parts.push(`${disabled} disabled`);
  return parts.join(', ');
}

export function mcpServerStatusKey(server: McpServerStatusSnapshot): string {
  return JSON.stringify([server.status, server.transport, server.toolCount, server.error]);
}
