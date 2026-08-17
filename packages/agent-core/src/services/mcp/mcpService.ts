/**
 * `McpService` — implementation of `IMcpService`.
 */

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'pathe';
import * as lockfile from 'proper-lockfile';
import type { McpServer } from '@pymodel/protocol';

import { McpServerConfigSchema, type McpServerConfig } from '#/config/schema';
import { readMcpJsonDocument, resolveMcpJsonPaths } from '#/mcp/config-loader';
import { atomicWrite } from '#/utils/fs';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEnvironmentService } from '../environment/environment';
import {
  IMcpService,
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  toProtocolMcpServer,
} from './mcp';

export class McpService extends Disposable implements IMcpService {
  readonly _serviceBrand: undefined;

  constructor(
    @ICoreProcessService private readonly core: ICoreProcessService,
    @IEnvironmentService private readonly environment: IEnvironmentService,
  ) {
    super();
  }

  async list(): Promise<readonly McpServer[]> {
    // `listMcpServers` is on the SessionAPI surface; we need a session id to
    // dispatch. Pick the most recently created one. If no sessions exist,
    // return an empty list (the MCP registrar may have started up but the
    // RPC plumbing isn't reachable until a session is open).
    const sessionId = await this._anyKnownSessionId();
    if (sessionId === undefined) return [];
    const raw = await this.core.rpc.listMcpServers({ sessionId });
    const definitions = await this._readUserDefinitions();
    return raw.map((server) => toProtocolMcpServer(server, definitions[server.name]));
  }

  async restart(serverId: string): Promise<{ restarting: true }> {
    const sessionId = await this._anyKnownSessionId();
    if (sessionId === undefined) {
      // No session => no MCP registrar reachable => server can't be reached.
      throw new McpServerNotFoundError(serverId);
    }
    // Existence check: the wire id is the agent-core `name`. The reconnect
    // call will reject for unknown names; we pre-check so the route can
    // emit a deterministic 40408 envelope without depending on agent-core
    // error message shape.
    const known = await this.core.rpc.listMcpServers({ sessionId });
    if (!known.some((s) => s.name === serverId)) {
      throw new McpServerNotFoundError(serverId);
    }
    await this.core.rpc.reconnectMcpServer({ sessionId, name: serverId });
    return { restarting: true };
  }

  async create(serverId: string, definition: unknown): Promise<void> {
    const config = parseMcpDefinition(definition);
    validateMcpServerId(serverId);
    await this._mutateUserFile((servers) => {
      if (Object.hasOwn(servers, serverId)) throw new McpServerAlreadyExistsError(serverId);
      return { ...servers, [serverId]: config };
    });
  }

  async update(serverId: string, definition: unknown): Promise<void> {
    const config = parseMcpDefinition(definition);
    validateMcpServerId(serverId);
    await this._mutateUserFile((servers) => {
      if (!Object.hasOwn(servers, serverId)) throw new McpServerNotFoundError(serverId);
      return { ...servers, [serverId]: config };
    });
  }

  async remove(serverId: string): Promise<void> {
    validateMcpServerId(serverId);
    await this._mutateUserFile((servers) => {
      if (!Object.hasOwn(servers, serverId)) throw new McpServerNotFoundError(serverId);
      return Object.fromEntries(Object.entries(servers).filter(([name]) => name !== serverId));
    });
  }

  /**
   * Find a usable session id for dispatching SessionAPI calls. Returns the
   * most recently created session id, or `undefined` when no sessions exist.
   */
  private async _anyKnownSessionId(): Promise<string | undefined> {
    const all = await this.core.rpc.listSessions({});
    if (all.length === 0) return undefined;
    // Sort by createdAt desc — newest sessions are the most likely to have
    // an active MCP RPC binding.
    const sorted = [...all].toSorted((a, b) => b.createdAt - a.createdAt);
    return sorted[0]?.id;
  }

  private async _readUserDefinitions(): Promise<Record<string, McpServerConfig>> {
    const filePath = await this._userMcpPath();
    const document = await readMcpJsonDocument(filePath);
    const definitions: Record<string, McpServerConfig> = {};
    for (const [name, value] of Object.entries(document.servers)) {
      const parsed = McpServerConfigSchema.safeParse(value);
      if (parsed.success) definitions[name] = parsed.data;
    }
    return definitions;
  }

  private async _mutateUserFile(
    mutate: (servers: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const filePath = await this._userMcpPath();
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(filePath, {
      realpath: false,
      retries: { retries: 10, minTimeout: 10, maxTimeout: 100 },
    });
    try {
      const document = await readMcpJsonDocument(filePath);
      const data = { ...document.data, mcpServers: mutate(document.servers) };
      await atomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
      await chmod(filePath, 0o600);
    } finally {
      await release();
    }
  }

  private async _userMcpPath(): Promise<string> {
    const paths = await resolveMcpJsonPaths({
      cwd: process.cwd(),
      homeDir: this.environment.homeDir,
    });
    return paths.user;
  }
}

function parseMcpDefinition(input: unknown): McpServerConfig {
  const parsed = McpServerConfigSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'definition'}: ${issue.message}`)
    .join('; ');
  throw new McpServerValidationError(message);
}

function validateMcpServerId(serverId: string): void {
  if (serverId.length === 0) throw new McpServerValidationError('MCP server id must not be empty');
  if (serverId !== serverId.trim()) {
    throw new McpServerValidationError('MCP server id must be trimmed');
  }
  if (/[\\/"]/.test(serverId)) {
    throw new McpServerValidationError('MCP server id must not contain a path separator or quote');
  }
}

// Self-register under the global singleton registry. All ctor deps are
// `@I…`-injected; `staticArguments = []`. `supportsDelayedInstantiation =
// false` preserves current reverse-dispose semantics.
registerSingleton(IMcpService, McpService, InstantiationType.Delayed);
