import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { startAgentToolMcpServer } from '../../src/mcp/tool-server';
import { testAgent } from '../agent/harness/agent';

describe('agent tool MCP server', () => {
  it('lists and executes active built-in tools', async () => {
    const context = testAgent();
    context.configure({ tools: ['TodoList'] });
    await context.rpc.setPermission({ mode: 'yolo' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await startAgentToolMcpServer(context.agent, {
      version: '1.2.3',
      transport: serverTransport,
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['TodoList']);

    const result = await client.callTool({ name: 'TodoList', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Todo list is empty.' }]);

    await client.close();
    await server.close();
  });
});
