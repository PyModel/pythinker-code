import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { emptyUsage, type ContentPart } from '@pythoughts/kosong';

import type { Agent } from '../agent';
import { runToolCallBatch } from '../loop/tool-call';
import type { ExecutableTool, ExecutableToolResult } from '../loop/types';

export interface AgentToolMcpServerOptions {
  readonly version: string;
  readonly transport?: Transport;
  readonly onClose?: () => void;
}

export async function startAgentToolMcpServer(
  agent: Agent,
  options: AgentToolMcpServerOptions,
): Promise<Server> {
  const server = new Server(
    { name: 'pythinker-code', version: options.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => ({
    tools: activeBuiltinTools(agent).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as McpTool['inputSchema'],
    })),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params }, { signal }): Promise<CallToolResult> => {
      const tool = activeBuiltinTools(agent).find((candidate) => candidate.name === params.name);
      if (tool === undefined) throw new Error(`Tool "${params.name}" not found`);
      try {
        const result = await executeAgentTool(agent, tool, params.arguments ?? {}, signal);
        return {
          content: toMcpContent(result.output),
          isError: result.isError === true,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.onclose = options.onClose;
  await server.connect(options.transport ?? new StdioServerTransport());
  return server;
}

function activeBuiltinTools(agent: Agent): readonly ExecutableTool[] {
  const names = new Set(
    agent.tools
      .data()
      .filter((tool) => tool.active && tool.source === 'builtin')
      .map((tool) => tool.name),
  );
  return agent.tools.loopTools.filter((tool) => names.has(tool.name));
}

async function executeAgentTool(
  agent: Agent,
  tool: ExecutableTool,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ExecutableToolResult> {
  const id = randomUUID();
  let result: ExecutableToolResult | undefined;
  const toolCall = {
    type: 'function' as const,
    id,
    name: tool.name,
    arguments: JSON.stringify(args),
  };
  await runToolCallBatch(
    {
      tools: [tool],
      hooks: {
        authorizeToolExecution: (context) => agent.permission.beforeToolCall(context),
      },
      dispatchEvent: async (event) => {
        if (event.type === 'tool.result') result = event.result;
      },
      llm: agent.llm,
      signal,
      turnId: '0',
      currentStep: 1,
      stepUuid: id,
    },
    {
      toolCalls: [toolCall],
      usage: emptyUsage(),
    },
  );
  if (result === undefined) throw new Error(`Tool "${tool.name}" returned no result`);
  return result;
}

function toMcpContent(output: ExecutableToolResult['output']): CallToolResult['content'] {
  if (typeof output === 'string') return [{ type: 'text', text: output }];
  return output.map(toMcpContentPart);
}

function toMcpContentPart(part: ContentPart): CallToolResult['content'][number] {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'think') return { type: 'text', text: part.think };
  if (part.type === 'image_url') return toMcpMedia('image', part.imageUrl.url);
  if (part.type === 'audio_url') return toMcpMedia('audio', part.audioUrl.url);
  return {
    type: 'resource_link',
    name: 'video',
    uri: part.videoUrl.url,
  };
}

function toMcpMedia(
  type: 'image' | 'audio',
  url: string,
): CallToolResult['content'][number] {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(url);
  if (match !== null) {
    return {
      type,
      mimeType: match[1]!,
      data: match[2]!,
    };
  }
  return {
    type: 'resource_link',
    name: type,
    uri: url,
  };
}
