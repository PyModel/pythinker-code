import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { UrlElicitationRequiredError } from '@modelcontextprotocol/sdk/types.js';

const server = new McpServer({ name: 'elicitation-stdio', version: '0.0.1' });

server.registerTool(
  'collect_profile',
  {
    description: 'Collects a profile through MCP form elicitation',
    inputSchema: {},
  },
  async () => {
    const result = await server.server.elicitInput({
      mode: 'form',
      message: 'Provide a test profile.',
      requestedSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            title: 'Name',
            description: 'Display name',
            minLength: 1,
          },
          newsletter: {
            type: 'boolean',
            title: 'Newsletter',
          },
          role: {
            type: 'string',
            title: 'Role',
            oneOf: [
              { const: 'developer', title: 'Developer' },
              { const: 'designer', title: 'Designer' },
            ],
          },
          age: {
            type: 'integer',
            title: 'Age',
            minimum: 0,
          },
          interests: {
            type: 'array',
            title: 'Interests',
            items: {
              type: 'string',
              enum: ['frontend', 'backend', 'devops'],
            },
            minItems: 1,
          },
          due: {
            type: 'string',
            title: 'Due date',
            format: 'date',
          },
        },
        required: ['name', 'newsletter', 'role', 'interests', 'due'],
      },
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  'open_account',
  {
    description: 'Opens an account page through MCP URL elicitation',
    inputSchema: {},
  },
  async () => {
    const elicitationId = 'test-account';
    const complete = server.server.createElicitationCompletionNotifier(elicitationId);
    const result = await server.server.elicitInput({
      mode: 'url',
      message: 'Open the test account page.',
      elicitationId,
      url: 'https://example.test/account',
    });
    if (result.action === 'accept') {
      setTimeout(() => {
        void complete();
      }, 10);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  'open_unsafe_url',
  {
    description: 'Requests a non-web URL for validation coverage',
    inputSchema: {},
  },
  async () => {
    const result = await server.server.elicitInput({
      mode: 'url',
      message: 'Open a local file.',
      elicitationId: 'unsafe-url',
      url: 'file:///tmp/example.txt',
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

let accountUnlocked = false;
server.registerTool(
  'unlock_account',
  {
    description: 'Retries after URL elicitation completes',
    inputSchema: {},
  },
  () => {
    if (!accountUnlocked) {
      const elicitationId = 'unlock-account';
      const complete = server.server.createElicitationCompletionNotifier(elicitationId);
      setTimeout(() => {
        accountUnlocked = true;
        void complete();
      }, 20);
      throw new UrlElicitationRequiredError([
        {
          mode: 'url',
          message: 'Unlock the test account.',
          elicitationId,
          url: 'https://example.test/unlock',
        },
      ]);
    }
    return {
      content: [{ type: 'text', text: 'account unlocked' }],
    };
  },
);

await server.connect(new StdioServerTransport());
