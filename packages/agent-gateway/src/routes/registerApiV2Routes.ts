import {
  IConfigService,
  IFlagService,
  MCP_MANAGEMENT_FLAG_ID,
  type Scope,
} from '@pymodel/agent-core-v2';

import { registerV2McpRoutes } from './v2/mcp';
import { registerV2SessionsRoutes } from './v2/sessions';

interface ApiV2AppHost {
  register(
    plugin: (apiV2: unknown) => Promise<void> | void,
    opts: { prefix: string },
  ): unknown;
}

export async function registerApiV2Routes(app: ApiV2AppHost, core: Scope): Promise<void> {
  await core.accessor.get(IConfigService).ready;
  const mcpManagementEnabled = core.accessor
    .get(IFlagService)
    .enabled(MCP_MANAGEMENT_FLAG_ID);
  await app.register(
    async (apiV2) => {
      registerV2SessionsRoutes(apiV2 as Parameters<typeof registerV2SessionsRoutes>[0], core);
      if (mcpManagementEnabled) {
        registerV2McpRoutes(apiV2 as Parameters<typeof registerV2McpRoutes>[0], core);
      }
    },
    { prefix: '/api/v2' },
  );
}
