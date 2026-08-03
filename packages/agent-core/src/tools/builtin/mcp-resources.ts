import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

import type { Kaos } from '@pythoughts/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../agent/tool';
import type { McpConnectionManager } from '../../mcp';
import type { MCPResourceContent } from '../../mcp/types';
import { ToolAccesses } from '../../loop/tool-access';
import type {
  ExecutableToolContext,
  ExecutableToolResult,
  ToolExecution,
} from '../../loop/types';
import { extensionForMimeType } from '../support/file-type';
import { toInputJsonSchema } from '../support/input-schema';
import { ToolResultBuilder } from '../support/result-builder';

export const ListMcpResourcesInputSchema = z.object({
  server: z.string().optional().describe('Optional MCP server name to filter resources by.'),
});
export type ListMcpResourcesInput = z.infer<typeof ListMcpResourcesInputSchema>;

export class ListMcpResourcesTool implements BuiltinTool<ListMcpResourcesInput> {
  readonly name = 'ListMcpResourcesTool' as const;
  readonly description =
    'Lists available resources from connected MCP servers. Each resource includes the server that provides it.';
  readonly parameters = toInputJsonSchema(ListMcpResourcesInputSchema);

  constructor(private readonly mcp: McpConnectionManager) {}

  resolveExecution(args: ListMcpResourcesInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description:
        args.server === undefined
          ? 'Listing MCP resources'
          : `Listing MCP resources from ${args.server}`,
      approvalRule: this.name,
      execute: (context) => this.execute(args, context),
    };
  }

  private async execute(
    args: ListMcpResourcesInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const entries = this.mcp.list();
    const selected =
      args.server === undefined ? entries : entries.filter((entry) => entry.name === args.server);
    if (args.server !== undefined && selected.length === 0) {
      return {
        isError: true,
        output: `Server "${args.server}" not found. Available servers: ${entries
          .map((entry) => entry.name)
          .join(', ')}`,
      };
    }

    try {
      const results = await Promise.all(
        selected.map(async (entry) => {
          if (entry.status !== 'connected') return [];
          const client = this.mcp.resolved(entry.name)?.client;
          if (client?.listResources === undefined) return [];
          try {
            const resources = await client.listResources(context.signal);
            return resources.map((resource) => ({ ...resource, server: entry.name }));
          } catch {
            context.signal.throwIfAborted();
            return [];
          }
        }),
      );
      const resources = results.flat();
      if (resources.length === 0) {
        return {
          output:
            'No resources found. MCP servers may still provide tools even if they have no resources.',
        };
      }
      return jsonResult(resources);
    } catch (error) {
      return {
        isError: true,
        output: `Failed to list MCP resources: ${errorMessage(error)}`,
      };
    }
  }
}

export const ReadMcpResourceInputSchema = z.object({
  server: z.string().describe('The MCP server name.'),
  uri: z.string().describe('The resource URI to read.'),
});
export type ReadMcpResourceInput = z.infer<typeof ReadMcpResourceInputSchema>;

export class ReadMcpResourceTool implements BuiltinTool<ReadMcpResourceInput> {
  readonly name = 'ReadMcpResourceTool' as const;
  readonly description = 'Reads a resource from a connected MCP server by server name and URI.';
  readonly parameters = toInputJsonSchema(ReadMcpResourceInputSchema);

  constructor(
    private readonly mcp: McpConnectionManager,
    private readonly kaos: Kaos,
  ) {}

  resolveExecution(args: ReadMcpResourceInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: `Reading MCP resource: ${args.uri}`,
      approvalRule: this.name,
      execute: (context) => this.execute(args, context),
    };
  }

  private async execute(
    args: ReadMcpResourceInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const entry = this.mcp.list().find(({ name }) => name === args.server);
    if (entry === undefined) {
      return {
        isError: true,
        output: `Server "${args.server}" not found. Available servers: ${this.mcp
          .list()
          .map(({ name }) => name)
          .join(', ')}`,
      };
    }
    if (entry.status !== 'connected') {
      return { isError: true, output: `Server "${args.server}" is not connected.` };
    }

    const client = this.mcp.resolved(args.server)?.client;
    if (client?.readResource === undefined) {
      return { isError: true, output: `Server "${args.server}" does not support resources.` };
    }

    try {
      const contents = await client.readResource(args.uri, context.signal);
      const rendered = await Promise.all(
        contents.map((content) => this.renderContent(content)),
      );
      return jsonResult({ contents: rendered });
    } catch (error) {
      return {
        isError: true,
        output: `Failed to read MCP resource from "${args.server}": ${errorMessage(error)}`,
      };
    }
  }

  private async renderContent(content: MCPResourceContent): Promise<Record<string, unknown>> {
    if ('text' in content) {
      return { uri: content.uri, mimeType: content.mimeType, text: content.text };
    }

    const paths = this.kaos.pathClass() === 'win32' ? win32 : posix;
    const directory = paths.join(this.kaos.gethome(), '.pythinker-code', 'tool-results');
    const filepath = paths.join(
      directory,
      `mcp-resource-${randomUUID()}.${extensionForMimeType(content.mimeType)}`,
    );
    const bytes = Buffer.from(content.blob, 'base64');
    try {
      await this.kaos.mkdir(directory, { parents: true, existOk: true });
      await this.kaos.writeBytes(filepath, bytes);
      return {
        uri: content.uri,
        mimeType: content.mimeType,
        blobSavedTo: filepath,
        text: `Binary content (${content.mimeType ?? 'unknown type'}, ${formatBytes(bytes.length)}) saved to ${filepath}`,
      };
    } catch (error) {
      return {
        uri: content.uri,
        mimeType: content.mimeType,
        text: `Binary content could not be saved to disk: ${errorMessage(error)}`,
      };
    }
  }
}

function jsonResult(value: unknown): ExecutableToolResult {
  const builder = new ToolResultBuilder({ maxChars: 100_000, maxLineLength: null });
  builder.write(JSON.stringify(value, null, 2));
  return builder.ok();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
