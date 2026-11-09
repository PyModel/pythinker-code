import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const MCP_MANAGEMENT_FLAG_ID = 'mcp-management';
export const MCP_MANAGEMENT_FLAG_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_MCP_MANAGEMENT';

export const mcpManagementFlag: FlagDefinitionInput = {
  id: MCP_MANAGEMENT_FLAG_ID,
  title: 'MCP management',
  description: 'Enable the MCP configuration, inspection, connection-test, and OAuth surfaces.',
  env: MCP_MANAGEMENT_FLAG_ENV,
  default: false,
  surface: 'both',
};

registerFlagDefinition(mcpManagementFlag);
