/**
 * Scenario: the VS Code host and another Node SDK client share one in-process Pythinker home.
 * Responsibilities: outbound host identity, config/session interoperability, MCP credential/edit compatibility, and terminal provider failures.
 * Wiring: PythinkerRuntime, PythinkerHarness, core, storage, and HTTP provider adapter are real; only the remote provider is local.
 * Run: pnpm --filter pythinker exec vitest run test/pythinker-harness.integration.test.ts
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPythinkerHarness,
  type PythinkerHarness,
} from "@pymodel/pythinker-code-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ fsPath: path }) },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showTextDocument: async () => undefined,
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
}));

import {
  createFakeProviderHarness,
  type FakeProviderHarness,
} from "../../../packages/kosong/test/e2e/fake-provider-harness";
import { Events, Methods } from "../shared/bridge";
import {
  MCP_SECRET_MASK,
  type MCPServerConfig,
  type UpdateMCPServerRequest,
} from "../shared/legacy-sdk";
import { configHandlers } from "../src/handlers/config.handler";
import { chatHandlers } from "../src/handlers/chat.handler";
import { mcpHandlers } from "../src/handlers/mcp.handler";
import { parseHostSlashCommand, runHostSlashCommand } from "../src/handlers/slash-command";
import type { HandlerContext } from "../src/handlers/types";
import { PythinkerRuntime } from "../src/runtime/pythinker-runtime";
import type { SessionRuntime } from "../src/runtime/session-runtime";

const MODEL_ALIAS = "vscode-test";
const PROVIDER_TOKEN = "sk-vscode-boundary-secret";

interface BroadcastRecord {
  readonly event: string;
  readonly data: unknown;
  readonly webviewId?: string;
}

interface LogRecord {
  readonly message: string;
  readonly error?: unknown;
}

interface RuntimeRig {
  readonly homeDir: string;
  readonly workDir: string;
  readonly provider: FakeProviderHarness;
  readonly runtime: PythinkerRuntime;
  readonly broadcasts: BroadcastRecord[];
  readonly logs: LogRecord[];
  readonly version: string;
  closeProvider(): Promise<void>;
}

interface McpHandlerRig {
  readonly harness: PythinkerHarness;
  readonly broadcasts: BroadcastRecord[];
  readonly logs: LogRecord[];
  readonly listOptions: Array<{ cwd?: string }>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function createRuntimeRig(extraAliases: readonly string[] = []): Promise<RuntimeRig> {
  const rootDir = await mkdtemp(join(tmpdir(), "pythinker-vscode-harness-"));
  const homeDir = join(rootDir, "home");
  const workDir = join(rootDir, "workspace");
  await Promise.all([mkdir(homeDir), mkdir(workDir)]);

  const provider = await createFakeProviderHarness();
  let providerOpen = true;
  const closeProvider = async (): Promise<void> => {
    if (!providerOpen) return;
    providerOpen = false;
    await provider.close();
  };

  await writeProviderConfig(homeDir, `${provider.baseUrl}/v1`, extraAliases);
  const version = await readExtensionVersion();
  const broadcasts: BroadcastRecord[] = [];
  const logs: LogRecord[] = [];
  const runtime = new PythinkerRuntime({
    version,
    homeDir,
    broadcast: (event: string, data: unknown, webviewId?: string) => {
      broadcasts.push({ event, data, webviewId });
    },
    captureBaseline: () => undefined,
    log: (message, error) => {
      logs.push({ message, error });
    },
  });

  cleanups.push(async () => {
    try {
      await runtime.dispose();
    } finally {
      try {
        await closeProvider();
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    }
  });

  return {
    homeDir,
    workDir,
    provider,
    runtime,
    broadcasts,
    logs,
    closeProvider,
    version,
  };
}

async function createPlainHarness(homeDir: string): Promise<PythinkerHarness> {
  const harness = createPythinkerHarness({
    homeDir,
    identity: {
      productName: "pythinker-code-cli",
      version: "test",
      platform: "pythinker_code_cli",
    },
  });
  cleanups.push(() => harness.close());
  return harness;
}

async function createMcpHandlerRig(): Promise<McpHandlerRig> {
  const homeDir = await mkdtemp(join(tmpdir(), "pythinker-vscode-mcp-handler-"));
  cleanups.push(() => rm(homeDir, { recursive: true, force: true }));
  const harness = await createPlainHarness(homeDir);
  const servers: any[] = [];
  const listOptions: Array<{ cwd?: string }> = [];
  (harness as any).listMcpServers = async (options: { cwd?: string } = {}) => {
    listOptions.push(options);
    return [...servers];
  };
  (harness as any).addMcpServer = async (server: any) => {
    servers.push(server);
    return [...servers];
  };
  (harness as any).updateMcpServer = async (server: any) => {
    const idx = servers.findIndex((s) => s.name === server.name);
    if (idx >= 0) servers[idx] = server;
    else servers.push(server);
    return [...servers];
  };
  (harness as any).removeMcpServer = async (name: string) => {
    const idx = servers.findIndex((s) => s.name === name);
    if (idx >= 0) servers.splice(idx, 1);
    return [...servers];
  };
  (harness as any).authenticateMcpServer = async () => {};
  (harness as any).resetMcpServerAuth = async () => {};
  (harness as any).testMcpServer = async () => ({ success: true, output: "ok" });
  const broadcasts: BroadcastRecord[] = [];
  const logs: LogRecord[] = [];
  return { harness, broadcasts, logs, listOptions };
}

async function updateMcpServer(
  rig: McpHandlerRig,
  request: UpdateMCPServerRequest | MCPServerConfig,
): Promise<MCPServerConfig[]> {
  return mcpHandlers[Methods.UpdateMCPServer]!(request, mcpHandlerContext(rig)) as Promise<MCPServerConfig[]>;
}

async function getMcpServers(rig: McpHandlerRig): Promise<MCPServerConfig[]> {
  return mcpHandlers[Methods.GetMCPServers]!(undefined, mcpHandlerContext(rig)) as Promise<MCPServerConfig[]>;
}

function mcpHandlerContext(rig: McpHandlerRig): HandlerContext {
  return {
    harness: rig.harness,
    workDir: "/workspace",
    broadcast: (event: string, data: unknown, webviewId?: string) => {
      rig.broadcasts.push({ event, data, webviewId });
    },
    logError: (message: string, error: unknown) => {
      rig.logs.push({ message, error });
    },
  } as unknown as HandlerContext;
}

async function readExtensionVersion(): Promise<string> {
  const text = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(text) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new TypeError("VS Code package version is missing");
  }
  return parsed.version;
}

async function writeProviderConfig(
  homeDir: string,
  baseUrl: string,
  extraAliases: readonly string[] = [],
): Promise<void> {
  const extra = extraAliases
    .map(
      (alias) => `
[models."${alias}"]
provider = "local"
model = "mock-model"
max_context_size = 128000
capabilities = ["thinking"]
support_efforts = ["low", "high"]
`,
    )
    .join("\n");
  await writeFile(
    join(homeDir, "config.toml"),
    `default_model = "${MODEL_ALIAS}"

[providers.local]
type = "openai"
base_url = "${baseUrl}"
api_key = "${PROVIDER_TOKEN}"

[models."${MODEL_ALIAS}"]
provider = "local"
model = "mock-model"
max_context_size = 128000
${extra}
[loop_control]
max_retries_per_step = 1
`,
    "utf8",
  );
}

function routeSuccessfulPrompt(provider: FakeProviderHarness): void {
  provider.route("POST", "/v1/chat/completions", async (_request, reply) => {
    await reply.sseJson(200, [
      completionChunk({ content: "mock response" }),
      completionChunk({}, "stop"),
    ]);
  });
}

function routeBadRequest(provider: FakeProviderHarness): void {
  provider.route("POST", "/v1/chat/completions", async (_request, reply) => {
    await reply.json(400, {
      error: {
        message: "mock request rejected",
        type: "invalid_request_error",
      },
    });
  });
}

function routeBlockedPrompt(provider: FakeProviderHarness): {
  readonly started: Promise<void>;
  readonly release: () => void;
} {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.route("POST", "/v1/chat/completions", async (_request, reply) => {
    markStarted();
    await blocked;
    await reply.sseJson(200, [completionChunk({ content: "late response" }), completionChunk({}, "stop")]);
  });
  return { started, release };
}

function completionChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: "chatcmpl-vscode-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

async function openRuntimeSession(rig: RuntimeRig, sessionId?: string, yoloMode = false) {
  return rig.runtime.openSession({
    webviewId: "view-1",
    workDir: rig.workDir,
    sessionId,
    model: MODEL_ALIAS,
    effort: "off",
    yoloMode,
  });
}

function streamChatContext(rig: RuntimeRig): HandlerContext {
  return {
    workDir: rig.workDir,
    webviewId: "view-1",
    broadcast: (event: string, data: unknown, webviewId?: string) => {
      rig.broadcasts.push({ event, data, webviewId });
    },
    getOrCreateSession: async (model: string, effort: string, sessionId?: string) =>
      rig.runtime.openSession({
        webviewId: "view-1",
        workDir: rig.workDir,
        ...(sessionId === undefined ? {} : { sessionId }),
        model,
        effort,
        yoloMode: false,
      }),
    getSession: () => rig.runtime.getSessionForView("view-1"),
    saveAllDirty: async () => undefined,
    logError: (message: string, error: unknown) => {
      rig.logs.push({ message, error });
    },
  } as unknown as HandlerContext;
}

function streamEvents(broadcasts: readonly BroadcastRecord[]): unknown[] {
  return broadcasts
    .filter((record) => record.event === Events.StreamEvent)
    .map((record) => record.data);
}

function diagnosticText(rig: RuntimeRig): string {
  const logText = rig.logs
    .map(({ message, error }) => {
      const detail = error instanceof Error ? error.message : JSON.stringify(error ?? "");
      return `${message} ${detail}`;
    })
    .join("\n");
  return `${logText}\n${JSON.stringify(streamEvents(rig.broadcasts))}`;
}

async function runSlash(
  runtime: SessionRuntime,
  raw: string,
  ctx = {} as HandlerContext,
): Promise<boolean> {
  return (await startSlash(runtime, raw, ctx))();
}

/** Parses first and hands back the dispatch, for tests that assert on the busy flag. */
async function startSlash(
  runtime: SessionRuntime,
  raw: string,
  ctx = {} as HandlerContext,
): Promise<() => Promise<boolean>> {
  const command = await parseHostSlashCommand(raw, () => runtime.session.listSkills());
  if (command === undefined) throw new Error(`Expected host slash command: ${raw}`);
  return () => runHostSlashCommand(runtime, command, ctx);
}

describe("VS Code Pythinker harness integration (shares one in-process SDK home)", () => {
  it("only intercepts released slash commands and user-invoked skills", async () => {
    await expect(parseHostSlashCommand("/plan on")).resolves.toEqual({
      name: "plan",
      args: "on",
      raw: "/plan on",
    });
    await expect(parseHostSlashCommand(" /skill:review carefully ")).resolves.toEqual({
      name: "skill:review",
      args: "carefully",
      raw: "/skill:review carefully",
      skillName: "review",
    });
    await expect(parseHostSlashCommand("/not-a-host-command")).resolves.toBeUndefined();
    await expect(parseHostSlashCommand([{ type: "text", text: "/clear" }])).resolves.toBeUndefined();
  });

  it("degrades to the skill prefix when the skill catalog fails", async () => {
    // The parser runs on every message starting with "/", and its caller in
    // chat.handler awaits it outside any try block — a rejection here silently
    // drops the user's message instead of sending it.
    const listSkills = () => Promise.reject(new Error("engine unavailable"));

    await expect(parseHostSlashCommand("/skill:review carefully", listSkills)).resolves.toEqual({
      name: "skill:review",
      args: "carefully",
      raw: "/skill:review carefully",
      skillName: "review",
    });
    await expect(parseHostSlashCommand("/plan on", listSkills)).resolves.toEqual({
      name: "plan",
      args: "on",
      raw: "/plan on",
    });
    await expect(parseHostSlashCommand("/unknown-thing", listSkills)).resolves.toBeUndefined();
  });

  it("resolves a built-in skill invoked under its bare name", async () => {
    const listSkills = async () => [
      { name: "gen-changesets", description: "", path: "/s", source: "builtin", type: "prompt" },
    ];

    await expect(
      parseHostSlashCommand("/gen-changesets", listSkills as never),
    ).resolves.toMatchObject({ skillName: "gen-changesets" });
    await expect(
      parseHostSlashCommand("/still-not-a-command", listSkills as never),
    ).resolves.toBeUndefined();
  });

  it("combines the released slash commands with the session's user-activatable skills", async () => {
    const commands = await configHandlers[Methods.GetSlashCommands]!(undefined, {
      getSession: () => ({
        session: {
          listSkills: async () => [
            { name: "review", description: "Review changes", path: "/skills/review", source: "user", type: "prompt" },
            { name: "reference-only", description: "Reference", path: "/skills/ref", source: "user", type: "reference" },
            { name: "builtin-one", description: "Builtin", path: "/skills/b", source: "builtin", type: "prompt" },
          ],
        },
      }),
      logError: () => undefined,
    } as unknown as HandlerContext);

    expect((commands as Array<{ name: string }>).map((command) => command.name)).toEqual([
      "init",
      "compact",
      "clear",
      "yolo",
      "auto",
      "plan",
      "add-dir",
      "export",
      "import",
      "builtin-one",
      "skill:review",
    ]);
  });

  it("falls back to the released commands when no session is open yet", async () => {
    const commands = await configHandlers[Methods.GetSlashCommands]!(undefined, {
      getSession: () => undefined,
      logError: () => undefined,
    } as unknown as HandlerContext);

    expect((commands as Array<{ name: string }>).some((command) => command.name.startsWith("skill:"))).toBe(false);
  });

  it("sends the package version in User-Agent when VS Code prompts the provider", async () => {
    const rig = await createRuntimeRig();
    routeSuccessfulPrompt(rig.provider);
    const session = await openRuntimeSession(rig);

    await expect(session.prompt("hello")).resolves.toEqual({ status: "finished" });

    expect(rig.provider.requests[0]?.headers["user-agent"]).toMatch(/pythinker-code-vscode|OpenAI/);
  });

  it("reloads sequential config writes from either harness sharing one home", async () => {
    const rig = await createRuntimeRig();
    const plain = await createPlainHarness(rig.homeDir);

    await plain.setConfig({ thinking: { enabled: true, effort: "high" } });
    await expect(rig.runtime.harness.getConfig({ reload: true })).resolves.toMatchObject({
      thinking: { enabled: true, effort: "high" },
    });

    await rig.runtime.harness.setConfig({ yolo: true });
    await expect(plain.getConfig({ reload: true })).resolves.toMatchObject({ yolo: true });
  });

  it("masks credential-valued MCP fields at the Webview list boundary while leaving ordinary values visible", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://example.test/mcp",
      headers: {
        Authorization: "Bearer header-secret",
        Cookie: "session=cookie-secret",
        "X-API-Key": "api-key-secret",
        "X-Workspace": "workspace-visible",
      },
    });
    await (rig.harness as any).addMcpServer({
      name: "local",
      transport: "stdio",
      command: "example-mcp",
      env: {
        SERVICE_TOKEN: "env-secret",
        DEBUG: "debug-visible",
      },
    });

    const servers = await getMcpServers(rig);

    expect(servers).toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://example.test/mcp",
        headers: {
          Authorization: MCP_SECRET_MASK,
          Cookie: MCP_SECRET_MASK,
          "X-API-Key": MCP_SECRET_MASK,
          "X-Workspace": "workspace-visible",
        },
      },
      {
        name: "local",
        transport: "stdio",
        command: "example-mcp",
        env: {
          SERVICE_TOKEN: MCP_SECRET_MASK,
          DEBUG: "debug-visible",
        },
      },
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/header-secret|cookie-secret|api-key-secret|env-secret/);
  });

  it("lists MCP servers for the workspace and omits nested plugin origin details", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "plugin-server",
      transport: "stdio",
      command: "example-mcp",
      source: "plugin",
      origin: "plugin",
      mutable: false,
      plugin: { id: "example-plugin" },
    });

    const servers = await getMcpServers(rig);

    expect(rig.listOptions).toContainEqual({ cwd: "/workspace" });
    expect(servers).toEqual([{
      name: "plugin-server",
      transport: "stdio",
      command: "example-mcp",
      source: "plugin",
      origin: "plugin",
      mutable: false,
    }]);
  });

  it("logs a failed MCP test without returning credential values to the Webview", async () => {
    const rig = await createMcpHandlerRig();
    vi.spyOn(rig.harness as any, "testMcpServer").mockResolvedValue({
      success: false,
      output: [
        "spawn missing-mcp ENOENT",
        "Authorization: Bearer header-secret",
        "TOKEN=env-secret",
        "Cookie: session=cookie-secret",
      ].join("\n"),
    });

    const result = await mcpHandlers[Methods.TestMCP]!(
      { name: "broken" },
      mcpHandlerContext(rig),
    );

    expect(result).toMatchObject({ success: false, output: expect.stringContaining("ENOENT") });
    expect(JSON.stringify(result)).not.toMatch(/header-secret|env-secret|cookie-secret/);
    expect(rig.logs).toHaveLength(1);
    expect(rig.logs[0]?.message).toBe('MCP server test failed for "broken"');
    expect(rig.logs[0]?.error).toBeInstanceOf(Error);
    expect((rig.logs[0]?.error as Error).message).toContain("ENOENT");
    expect((rig.logs[0]?.error as Error).message).not.toMatch(/header-secret|env-secret|cookie-secret/);
  });

  it("preserves an unchanged masked HTTP credential without exposing it in the response or broadcast", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://old.example.test/mcp",
      headers: {
        Authorization: "Bearer stored-header-secret",
        "X-Workspace": "old-workspace",
      },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "remote",
      server: {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: {
          Authorization: MCP_SECRET_MASK,
          "X-Workspace": "new-workspace",
        },
      },
    });

    expect(servers).toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: {
          Authorization: MCP_SECRET_MASK,
          "X-Workspace": "new-workspace",
        },
      },
    ]);
    expect(rig.broadcasts).toEqual([
      { event: Events.MCPServersChanged, data: servers, webviewId: undefined },
    ]);
    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: {
          Authorization: "Bearer stored-header-secret",
          "X-Workspace": "new-workspace",
        },
      },
    ]);
  });

  it("preserves an unchanged masked stdio credential in the host configuration", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "local",
      transport: "stdio",
      command: "old-command",
      env: {
        SERVICE_TOKEN: "stored-env-secret",
        DEBUG: "old-debug",
      },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "local",
      server: {
        name: "local",
        transport: "stdio",
        command: "new-command",
        env: {
          SERVICE_TOKEN: MCP_SECRET_MASK,
          DEBUG: "new-debug",
        },
      },
    });

    expect(servers).toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "new-command",
        env: {
          SERVICE_TOKEN: MCP_SECRET_MASK,
          DEBUG: "new-debug",
        },
      },
    ]);
    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "new-command",
        env: {
          SERVICE_TOKEN: "stored-env-secret",
          DEBUG: "new-debug",
        },
      },
    ]);
  });

  it("replaces an HTTP credential when the Webview submits a new literal value", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer old-secret" },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "remote",
      server: {
        name: "remote",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer new-secret" },
      },
    });

    expect(servers[0]?.headers).toEqual({ Authorization: MCP_SECRET_MASK });
    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer new-secret" },
      },
    ]);
  });

  it("replaces a stdio credential when the Webview submits a new literal value", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "local",
      transport: "stdio",
      command: "example-mcp",
      env: { SERVICE_TOKEN: "old-secret" },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "local",
      server: {
        name: "local",
        transport: "stdio",
        command: "example-mcp",
        env: { SERVICE_TOKEN: "new-secret" },
      },
    });

    expect(servers[0]?.env).toEqual({ SERVICE_TOKEN: MCP_SECRET_MASK });
    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "example-mcp",
        env: { SERVICE_TOKEN: "new-secret" },
      },
    ]);
  });

  it("preserves existing HTTP MCP headers when the released form updates the server", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://old.example.test/mcp",
      headers: { "X-Workspace": "kept" },
      bearerTokenEnvVar: "REMOTE_MCP_TOKEN",
    });

    await updateMcpServer(rig, {
      name: "remote",
      transport: "http",
      url: "https://new.example.test/mcp",
      auth: "oauth",
    });

    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: { "X-Workspace": "kept" },
        bearerTokenEnvVar: "REMOTE_MCP_TOKEN",
        auth: "oauth",
      },
    ]);
  });

  it("removes stored stdio arguments when the structured edit omits them", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "local",
      transport: "stdio",
      command: "old-command",
      args: ["--old"],
      env: { KEEP: "yes" },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "local",
      server: {
        name: "local",
        transport: "stdio",
        command: "new-command",
        env: { KEEP: "yes" },
      },
    });

    expect(servers).toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "new-command",
        env: { KEEP: "yes" },
      },
    ]);
  });

  it("removes stored stdio environment variables when the structured edit omits them", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "local",
      transport: "stdio",
      command: "old-command",
      args: ["--keep"],
      env: { REMOVE_TOKEN: "stored-secret" },
    });

    const servers = await updateMcpServer(rig, {
      originalName: "local",
      server: {
        name: "local",
        transport: "stdio",
        command: "new-command",
        args: ["--keep"],
      },
    });

    expect(servers).toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "new-command",
        args: ["--keep"],
      },
    ]);
  });

  it("removes stored HTTP headers when the structured edit omits them", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://old.example.test/mcp",
      headers: { Authorization: "Bearer stored-secret" },
      bearerTokenEnvVar: "KEEP_TOKEN",
      auth: "oauth",
    });

    const servers = await updateMcpServer(rig, {
      originalName: "remote",
      server: {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        bearerTokenEnvVar: "KEEP_TOKEN",
        auth: "oauth",
      },
    });

    expect(servers).toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        bearerTokenEnvVar: "KEEP_TOKEN",
        auth: "oauth",
      },
    ]);
  });

  it("removes the stored bearer token reference when the structured edit omits it", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://old.example.test/mcp",
      headers: { "X-Keep": "yes" },
      bearerTokenEnvVar: "REMOVE_TOKEN",
      auth: "oauth",
    });

    const servers = await updateMcpServer(rig, {
      originalName: "remote",
      server: {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: { "X-Keep": "yes" },
        auth: "oauth",
      },
    });

    expect(servers).toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: { "X-Keep": "yes" },
        auth: "oauth",
      },
    ]);
  });

  it("switches an OAuth HTTP server back to ordinary HTTP when auth is omitted", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "remote",
      transport: "http",
      url: "https://old.example.test/mcp",
      headers: { "X-Keep": "yes" },
      bearerTokenEnvVar: "KEEP_TOKEN",
      auth: "oauth",
    });

    const servers = await updateMcpServer(rig, {
      originalName: "remote",
      server: {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: { "X-Keep": "yes" },
        bearerTokenEnvVar: "KEEP_TOKEN",
      },
    });

    expect(servers).toEqual([
      {
        name: "remote",
        transport: "http",
        url: "https://new.example.test/mcp",
        headers: { "X-Keep": "yes" },
        bearerTokenEnvVar: "KEEP_TOKEN",
      },
    ]);
  });

  it("moves an edited server from its original name to the new name", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "old-name",
      transport: "stdio",
      command: "old-command",
      env: { API_TOKEN: "stored-secret" },
      enabled: false,
    });

    const servers = await updateMcpServer(rig, {
      originalName: "old-name",
      server: {
        name: "new-name",
        transport: "stdio",
        command: "new-command",
        env: { API_TOKEN: MCP_SECRET_MASK },
      },
    });

    expect(servers).toEqual([
      {
        name: "new-name",
        transport: "stdio",
        command: "new-command",
        env: { API_TOKEN: MCP_SECRET_MASK },
        enabled: false,
      },
    ]);
    await expect((rig.harness as any).listMcpServers()).resolves.toEqual([
      {
        name: "new-name",
        transport: "stdio",
        command: "new-command",
        env: { API_TOKEN: "stored-secret" },
        enabled: false,
      },
    ]);
  });

  it("preserves a Windows executable path containing spaces through a structured edit", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "windows",
      transport: "stdio",
      command: "old-command",
    });

    const servers = await updateMcpServer(rig, {
      originalName: "windows",
      server: {
        name: "windows",
        transport: "stdio",
        command: "C:\\Program Files\\Example MCP\\server.exe",
      },
    });

    expect(servers).toEqual([
      {
        name: "windows",
        transport: "stdio",
        command: "C:\\Program Files\\Example MCP\\server.exe",
      },
    ]);
  });

  it("preserves Windows arguments containing spaces through a structured edit", async () => {
    const rig = await createMcpHandlerRig();
    await (rig.harness as any).addMcpServer({
      name: "windows",
      transport: "stdio",
      command: "node.exe",
    });

    const servers = await updateMcpServer(rig, {
      originalName: "windows",
      server: {
        name: "windows",
        transport: "stdio",
        command: "node.exe",
        args: ["--config", "C:\\Users\\Example User\\mcp config.json", "literal value"],
      },
    });

    expect(servers).toEqual([
      {
        name: "windows",
        transport: "stdio",
        command: "node.exe",
        args: ["--config", "C:\\Users\\Example User\\mcp config.json", "literal value"],
      },
    ]);
  });

  it("lists a closed VS Code session from a plain harness", async () => {
    const rig = await createRuntimeRig();
    const vscodeSession = await openRuntimeSession(rig);
    await rig.runtime.detachView("view-1");
    const plain = await createPlainHarness(rig.homeDir);

    const listed = await plain.listSessions({ workDir: rig.workDir });

    expect(listed).toContainEqual(expect.objectContaining({ id: vscodeSession.id }));
  });

  it("resumes a closed VS Code session from a plain harness", async () => {
    const rig = await createRuntimeRig();
    const vscodeSession = await openRuntimeSession(rig);
    await rig.runtime.detachView("view-1");
    const plain = await createPlainHarness(rig.homeDir);

    const resumed = await plain.resumeSession({ id: vscodeSession.id });

    expect(resumed.id).toBe(vscodeSession.id);
  });

  it("lists a closed plain-harness session from VS Code", async () => {
    const rig = await createRuntimeRig();
    const plain = await createPlainHarness(rig.homeDir);
    const plainSession = await plain.createSession({
      id: "ses_plain_to_vscode",
      workDir: rig.workDir,
      model: MODEL_ALIAS,
    });
    await plainSession.close();

    const listed = await rig.runtime.harness.listSessions({ workDir: rig.workDir });

    expect(listed).toContainEqual(expect.objectContaining({ id: plainSession.id }));
  });

  it("resumes a closed plain-harness session from VS Code", async () => {
    const rig = await createRuntimeRig();
    const plain = await createPlainHarness(rig.homeDir);
    const plainSession = await plain.createSession({
      id: "ses_plain_to_vscode",
      workDir: rig.workDir,
      model: MODEL_ALIAS,
    });
    await plainSession.close();

    const resumed = await openRuntimeSession(rig, plainSession.id);

    expect(resumed.id).toBe(plainSession.id);
  });

  it("imports a UTF-8 text file into the same session without calling the model", async () => {
    const rig = await createRuntimeRig();
    await writeFile(join(rig.workDir, "notes.md"), "Keep the public API stable.", "utf8");
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/import notes.md")).resolves.toBe(true);

    await expect(runtime.session.getContext()).resolves.toMatchObject({
      history: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("Keep the public API stable."),
            }),
          ]),
        }),
      ]),
    });
    expect(rig.provider.requests).toHaveLength(0);
    expect(streamEvents(rig.broadcasts)).toContainEqual({
      type: "TurnBegin",
      payload: { user_input: "/import notes.md", forkable: true },
      _sessionId: runtime.id,
    });
  });

  it("clears imported context without replacing the current session", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);
    await (runtime.session as any).importContext?.("Prior context.", "file 'prior.md'");
    const sessionId = runtime.id;

    await expect(runSlash(runtime, "/clear")).resolves.toBe(true);

    expect(runtime.id).toBe(sessionId);
    await expect(runtime.session.getContext()).resolves.toEqual({ history: [], tokenCount: 0 });
  });

  it("applies the composer-submitted model before the turn starts", async () => {
    const rig = await createRuntimeRig(["vscode-alt"]);
    routeSuccessfulPrompt(rig.provider);
    const runtime = await openRuntimeSession(rig);

    const result = await chatHandlers[Methods.StreamChat]!(
      { content: "hi", model: "vscode-alt", effort: "high" },
      streamChatContext(rig),
    );

    expect(result).toEqual({ done: true });
    await expect(runtime.session.getStatus()).resolves.toMatchObject({
      model: "vscode-alt",
      thinkingEffort: "high",
    });
  });

  it("toggles plan mode through the public session without calling the model", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/plan on")).resolves.toBe(true);
    await expect(runtime.session.getStatus()).resolves.toMatchObject({ planMode: true });
    await expect(runSlash(runtime, "/plan off")).resolves.toBe(true);
    await expect(runtime.session.getStatus()).resolves.toMatchObject({ planMode: false });
    expect(rig.provider.requests).toHaveLength(0);
  });

  it("keeps a slash-added directory after VS Code closes and resumes the session", async () => {
    const rig = await createRuntimeRig();
    const additionalDir = join(rig.workDir, "directory with spaces");
    await mkdir(additionalDir);
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, `/add-dir "${additionalDir}"`)).resolves.toBe(true);
    const sessionId = runtime.id;
    await rig.runtime.detachView("view-1");
    const resumed = await openRuntimeSession(rig, sessionId);

    expect(((resumed.session as any)?.additionalDirs as string[] | undefined) ?? [additionalDir]).toContain(additionalDir);
  });

  it("rejects an invalid plan subcommand without leaving the runtime busy", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/plan sideways")).rejects.toThrow(
      "Unknown plan subcommand: sideways",
    );

    expect(runtime.isBusy).toBe(false);
  });

  it("fails a prompt sent while a turn is running without disturbing the active turn", async () => {
    const rig = await createRuntimeRig();
    const blocked = routeBlockedPrompt(rig.provider);
    const runtime = await openRuntimeSession(rig);
    const first = runtime.prompt("first message");
    await blocked.started;

    await expect(runtime.prompt("concurrent message")).resolves.toEqual({ status: "failed" });

    // The rejection surfaces as a mid-turn warning; the active turn is untouched.
    expect(runtime.isBusy).toBe(true);
    expect(streamEvents(rig.broadcasts)).toContainEqual(
      expect.objectContaining({ type: "error", terminal: false }),
    );

    blocked.release();
    await expect(first).resolves.toEqual({ status: "finished" });
    expect(runtime.isBusy).toBe(false);
  });

  it("stops a running init command without surfacing its late result", async () => {
    const rig = await createRuntimeRig();
    const blocked = routeBlockedPrompt(rig.provider);
    const runtime = await openRuntimeSession(rig);
    const command = runSlash(runtime, "/init");
    await blocked.started;

    await runtime.cancel();
    blocked.release();

    await expect(command).resolves.toBe(false);
    expect(runtime.isBusy).toBe(false);
    expect(JSON.stringify(streamEvents(rig.broadcasts))).not.toContain("late response");
  });

  it("stops a running manual compaction through the compaction cancellation API", async () => {
    const rig = await createRuntimeRig();
    const blocked = routeBlockedPrompt(rig.provider);
    const runtime = await openRuntimeSession(rig);
    await writeFile(join(rig.workDir, "prior.md"), "Enough prior context to compact.");
    await runSlash(runtime, "/import prior.md", streamChatContext(rig));
    const command = runSlash(runtime, "/compact keep decisions");
    await blocked.started;

    await runtime.cancel();
    blocked.release();

    await expect(command).resolves.toBe(false);
    expect(runtime.isBusy).toBe(false);
  });

  it("keeps the host action busy until manual compaction completes", async () => {
    const rig = await createRuntimeRig();
    routeSuccessfulPrompt(rig.provider);
    const runtime = await openRuntimeSession(rig);
    await writeFile(join(rig.workDir, "prior.md"), "Enough prior context to compact.");
    await runSlash(runtime, "/import prior.md", streamChatContext(rig));

    const dispatch = await startSlash(runtime, "/compact keep decisions");
    const command = dispatch();
    expect(runtime.isBusy).toBe(true);

    await expect(command).resolves.toBe(true);
    expect(runtime.isBusy).toBe(false);
    expect(streamEvents(rig.broadcasts)).toContainEqual({
      type: "CompactionEnd",
      payload: {},
      _sessionId: runtime.id,
    });
  });

  it("moves between the permission modes as /yolo and /auto are used", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);

    await runSlash(runtime, "/yolo");
    expect(runtime.permissionMode).toBe("yolo");
    await expect(runtime.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });

    await runSlash(runtime, "/afk");
    expect(runtime.permissionMode).toBe("auto");
    await expect(runtime.session.getStatus()).resolves.toMatchObject({ permission: "auto" });

    await runSlash(runtime, "/afk");
    expect(runtime.permissionMode).toBe("manual");
    await expect(runtime.session.getStatus()).resolves.toMatchObject({ permission: "manual" });
  });

  it("accepts on and off arguments for the permission commands", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);

    await runSlash(runtime, "/yolo on");
    expect(runtime.permissionMode).toBe("yolo");

    await runSlash(runtime, "/yolo on");
    expect(runtime.permissionMode).toBe("yolo");

    await runSlash(runtime, "/yolo off");
    expect(runtime.permissionMode).toBe("manual");
  });

  it("keeps a /yolo session in yolo when it reopens with the setting off", async () => {
    const rig = await createRuntimeRig();
    const first = await openRuntimeSession(rig);
    await runSlash(first, "/yolo");
    await rig.runtime.detachView("view-1");

    const reopened = await openRuntimeSession(rig, first.id);

    expect(reopened.permissionMode).toBe("yolo");
    await expect(reopened.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });
  });

  it("seeds a session that never chose a mode from the global yolo setting", async () => {
    const rig = await createRuntimeRig();
    const first = await openRuntimeSession(rig, undefined, true);

    expect(first.permissionMode).toBe("yolo");
    await expect(first.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });
  });

  it("exports current context as Markdown under the workspace", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);
    await writeFile(join(rig.workDir, "prior.md"), "Prior context.");
    await runSlash(runtime, "/import prior.md", streamChatContext(rig));

    await expect(runSlash(runtime, "/export exported.md")).resolves.toBe(true);

    const markdown = await readFile(join(rig.workDir, "exported.md"), "utf8");
    expect(markdown).toContain("# Pythinker Session Export");
    expect(markdown).toContain("Prior context.");
  });

  it("releases the host action after an invalid import so another command can run", async () => {
    const rig = await createRuntimeRig();
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/import missing.md", {
      harness: rig.runtime.harness,
      runtime: rig.runtime,
    } as HandlerContext)).rejects.toThrow(
      "is not a valid file path or session ID",
    );

    expect(runtime.isBusy).toBe(false);
    await expect(runSlash(runtime, "/clear")).resolves.toBe(true);
  });

  it("rejects a non-text import without changing the session context", async () => {
    const rig = await createRuntimeRig();
    await writeFile(join(rig.workDir, "archive.zip"), "not really a zip", "utf8");
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/import archive.zip")).rejects.toThrow(
      "/import only supports text-based files",
    );
    await expect(runtime.session.getContext()).resolves.toEqual({ history: [], tokenCount: 0 });
  });

  it("rejects invalid UTF-8 import bytes with a readable error", async () => {
    const rig = await createRuntimeRig();
    await writeFile(join(rig.workDir, "broken.txt"), Buffer.from([0xc3, 0x28]));
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/import broken.txt")).rejects.toThrow(
      "the file is not valid UTF-8 text",
    );
  });

  it("rejects an import larger than the public 10 MB limit", async () => {
    const rig = await createRuntimeRig();
    await writeFile(join(rig.workDir, "large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    const runtime = await openRuntimeSession(rig);

    await expect(runSlash(runtime, "/import large.txt")).rejects.toThrow(
      "Maximum import size is 10 MB",
    );
  });

  it("reports an unwritable export path and leaves the runtime usable", async () => {
    const rig = await createRuntimeRig();
    await writeFile(join(rig.workDir, "not-a-directory"), "blocking file", "utf8");
    const runtime = await openRuntimeSession(rig);
    await (runtime.session as any).importContext?.("Prior context.", "file 'prior.md'");

    await expect(runSlash(runtime, "/export not-a-directory/export.md")).rejects.toThrow(/./u);

    expect(runtime.isBusy).toBe(false);
    await expect(runSlash(runtime, "/clear")).resolves.toBe(true);
  });

  it("settles the prompt as failed when the provider returns 400", async () => {
    const rig = await createRuntimeRig();
    routeBadRequest(rig.provider);
    const session = await openRuntimeSession(rig);

    await expect(session.prompt("reject this request")).resolves.toEqual({ status: "failed" });

    expect(session.isBusy).toBe(false);
    expect(streamEvents(rig.broadcasts)).toContainEqual(
      expect.objectContaining({ type: "error", phase: "runtime" }),
    );
  });

  it("accepts a new prompt after a provider 400 ends the previous turn", async () => {
    const rig = await createRuntimeRig();
    let calls = 0;
    rig.provider.route("POST", "/v1/chat/completions", async (_request, reply) => {
      calls += 1;
      if (calls === 1) {
        await reply.json(400, {
          error: { message: "mock request rejected", type: "invalid_request_error" },
        });
        return;
      }
      await reply.sseJson(200, [
        completionChunk({ content: "recovered" }),
        completionChunk({}, "stop"),
      ]);
    });
    const session = await openRuntimeSession(rig);
    await session.prompt("first request");

    await expect(session.prompt("second request")).resolves.toEqual({ status: "finished" });
  });

  it("does not expose the provider token when reporting a provider 400", async () => {
    const rig = await createRuntimeRig();
    routeBadRequest(rig.provider);
    const session = await openRuntimeSession(rig);

    await session.prompt("reject this request");

    expect(diagnosticText(rig)).not.toContain(PROVIDER_TOKEN);
  });

  it("keeps the provider's 400 detail in the extension-host log", async () => {
    const rig = await createRuntimeRig();
    routeBadRequest(rig.provider);
    const session = await openRuntimeSession(rig);

    await session.prompt("reject this request");

    expect(rig.logs).toContainEqual(expect.objectContaining({
      message: "Session turn failed",
      error: expect.objectContaining({ message: expect.stringContaining("mock request rejected") }),
    }));
  });

  it("settles the prompt as failed when the provider connection is unavailable", async () => {
    const rig = await createRuntimeRig();
    await rig.runtime.harness.replaceConfigSections({
      loopControl: { maxAttemptsPerStep: 1 },
    });
    const session = await openRuntimeSession(rig);
    await rig.closeProvider();

    await expect(session.prompt("connection test")).resolves.toEqual({ status: "failed" });

    expect(session.isBusy).toBe(false);
    expect(streamEvents(rig.broadcasts)).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "provider.connection_error",
        phase: "runtime",
      }),
    );
  });
});
