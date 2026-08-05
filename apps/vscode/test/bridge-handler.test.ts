/**
 * Scenario: untrusted Webview RPC messages cross into the VS Code extension host.
 * Responsibilities: validate requests, preserve public model metadata, omit private paths, and recover visibly from persisted state errors.
 * Wiring: the real BridgeHandler and handlers; VS Code and the public Node SDK harness boundary are replaced.
 * Run: pnpm --filter pythinker-code exec vitest run --config vitest.config.ts test/bridge-handler.test.ts
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type * as vscode from "vscode";

import { Methods } from "../shared/bridge";
import { BridgeHandler } from "../src/bridge-handler";

const host = vi.hoisted(() => {
  const watcher = {
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  };
  const harness = {
    homeDir: "/tmp/pythinker-code-test-home",
    close: vi.fn(async () => undefined),
    getConfig: vi.fn(),
    setConfig: vi.fn(async () => undefined),
    ensureConfigFile: vi.fn(async () => undefined),
    removeProvider: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    resumeSession: vi.fn(),
    forkSession: vi.fn(),
    deleteSession: vi.fn(async () => undefined),
  };
  const showWarningMessage = vi.fn(async () => undefined as string | undefined);

  class Uri {
    readonly scheme = "file";
    readonly authority = "";
    readonly path: string;

    constructor(readonly fsPath: string) {
      this.path = fsPath;
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
      return new Uri(join(base.fsPath, ...segments));
    }

    toString(): string {
      return `file://${this.path}`;
    }
  }

  return {
    Uri,
    watcher,
    harness,
    showWarningMessage,
    workspaceFolders: [] as Array<{ uri: Uri }>,
  };
});

vi.mock("vscode", () => ({
  Uri: host.Uri,
  workspace: {
    get workspaceFolders() {
      return host.workspaceFolders;
    },
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    createFileSystemWatcher: () => host.watcher,
    textDocuments: [],
  },
  window: { showWarningMessage: host.showWarningMessage },
}));

vi.mock("@pythoughts/pythinker-code-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pythoughts/pythinker-code-sdk")>();
  return { ...original, createPythinkerHarness: () => host.harness };
});

let bridge: BridgeHandler;
let root: string;
let showLogs: Mock<() => void>;
let writeLog: Mock<(message: string) => void>;
let workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pythinker-vscode-bridge-"));
  host.workspaceFolders.splice(0, host.workspaceFolders.length, { uri: new host.Uri(root) });
  showLogs = vi.fn();
  writeLog = vi.fn();
  host.harness.resumeSession.mockReset();
  host.harness.getConfig.mockReset();
  host.harness.getConfig.mockResolvedValue({ models: {} });
  host.showWarningMessage.mockReset();
  host.showWarningMessage.mockResolvedValue(undefined);
  workspaceState = { get: vi.fn((_key, fallback) => fallback), update: vi.fn() };
  bridge = new BridgeHandler(
    vi.fn(),
    workspaceState as unknown as vscode.Memento,
    join(root, "global-storage"),
    vi.fn(),
    showLogs,
    writeLog,
  );
});

afterEach(async () => {
  await bridge.dispose();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("Webview RPC boundary (validates requests before host dispatch)", () => {
  it("returns a readable error when the envelope is not a plain object", async () => {
    const result = await bridge.handle([], "view-1");

    expect(result).toEqual({
      id: "",
      error: "Invalid bridge request: expected a plain object.",
    });
  });

  it("does not execute a known handler when the request id is blank", async () => {
    const result = await bridge.handle({ id: " ", method: Methods.ShowLogs }, "view-1");

    expect(result).toEqual({
      id: "",
      error: "Invalid bridge request: id must be a non-empty string.",
    });
    expect(showLogs).not.toHaveBeenCalled();
  });

  it("reports aborted: false when the view has no runtime to cancel", async () => {
    const result = await bridge.handle({ id: "rpc-1", method: Methods.AbortChat }, "view-1");

    expect(result).toEqual({ id: "rpc-1", result: { aborted: false } });
  });

  it("cancels the view's runtime when aborting a chat", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.spyOn(bridge.runtime, "getSessionForView").mockReturnValue({ cancel } as never);

    const result = await bridge.handle({ id: "rpc-1", method: Methods.AbortChat }, "view-1");

    expect(result).toEqual({ id: "rpc-1", result: { aborted: true } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["missingMethod", "toString", "constructor", "__proto__"])(
    "does not dispatch the unknown or prototype method %s",
    async (method) => {
      const result = await bridge.handle({ id: "rpc-1", method }, "view-1");

      expect(result).toEqual({ id: "rpc-1", error: `Unknown bridge method: ${method}` });
      expect(showLogs).not.toHaveBeenCalled();
    },
  );

  it("does not execute a no-params handler when a payload is supplied", async () => {
    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.ShowLogs, params: {} },
      "view-1",
    );

    expect(result).toEqual({
      id: "rpc-1",
      error: "Invalid bridge params for method: showLogs",
    });
    expect(showLogs).not.toHaveBeenCalled();
  });

  it("does not execute an object-payload handler when a required field has the wrong type", async () => {
    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.AddInputHistory, params: { text: 42 } },
      "view-1",
    );

    expect(result).toEqual({
      id: "rpc-1",
      error: "Invalid bridge params for method: addInputHistory",
    });
    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it("dispatches a valid request through the existing bridge surface", async () => {
    const result = await bridge.handle({ id: "rpc-1", method: Methods.ShowLogs }, "view-1");

    expect(result).toEqual({ id: "rpc-1", result: { ok: true } });
    expect(showLogs).toHaveBeenCalledOnce();
  });

  it("keeps provider identity when configured models share a display name", async () => {
    host.harness.getConfig.mockResolvedValueOnce({
      defaultModel: "openai/shared",
      models: {
        "openai/shared": {
          provider: "openai",
          model: "shared",
          displayName: "Shared",
          maxContextSize: 128_000,
        },
        "proxy/shared": {
          provider: "company-proxy",
          model: "shared",
          displayName: "Shared",
          maxContextSize: 128_000,
        },
      },
    });

    const result = await bridge.handle({ id: "rpc-models", method: Methods.GetModels }, "view-1");

    expect(result).toMatchObject({
      id: "rpc-models",
      result: {
        defaultModel: "openai/shared",
        models: [
          { id: "openai/shared", name: "Shared", provider: "openai" },
          { id: "proxy/shared", name: "Shared", provider: "company-proxy" },
        ],
      },
    });
  });

  it("preserves adaptive thinking metadata in the Webview model list", async () => {
    host.harness.getConfig.mockResolvedValueOnce({
      defaultModel: "anthropic/claude",
      models: {
        "anthropic/claude": {
          provider: "anthropic",
          model: "claude-sonnet",
          maxContextSize: 200_000,
          adaptiveThinking: true,
        },
      },
    });

    const result = await bridge.handle({ id: "rpc-models", method: Methods.GetModels }, "view-1");

    expect(result).toMatchObject({
      result: {
        models: [{
          id: "anthropic/claude",
          name: "claude-sonnet",
          provider: "anthropic",
          adaptive_thinking: true,
        }],
      },
    });
  });

  it("does not expose the session storage path when listing sessions", async () => {
    host.harness.listSessions.mockResolvedValueOnce([
      {
        id: "session-1",
        workDir: root,
        sessionDir: "/private/pythinker/sessions/session-1",
        updatedAt: 123,
        title: "Visible title",
      },
    ] as never);

    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.GetSessions },
      "view-1",
    );

    expect(result).toEqual({
      id: "rpc-1",
      result: [{ id: "session-1", workDir: root, updatedAt: 123, brief: "Visible title" }],
    });
    expect(JSON.stringify(result)).not.toContain("/private/pythinker/sessions");
  });

  it("does not expose the session storage path when forking a session", async () => {
    const source = {
      id: "session-1",
      workDir: root,
      sessionDir: "/private/pythinker/sessions/session-1",
      updatedAt: 123,
    };
    const target = {
      id: "session-2",
      workDir: root,
      sessionDir: "/private/pythinker/sessions/session-2",
      updatedAt: 124,
    };
    host.harness.listSessions.mockResolvedValueOnce([source] as never);
    host.harness.forkSession.mockResolvedValueOnce({ summary: target, close: vi.fn() });

    const result = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.ForkSession,
        params: { sessionId: "session-1", turnIndex: 0 },
      },
      "view-1",
    );

    expect(result).toEqual({ id: "rpc-1", result: { sessionId: "session-2" } });
    expect(JSON.stringify(result)).not.toContain("/private/pythinker/sessions");
  });

  it("runs a fork through the active session cancellation boundary", async () => {
    const source = {
      id: "session-1",
      workDir: root,
      sessionDir: "/private/pythinker/sessions/session-1",
      updatedAt: 123,
    };
    const target = {
      id: "session-2",
      workDir: root,
      sessionDir: "/private/pythinker/sessions/session-2",
      updatedAt: 124,
    };
    const runExclusiveAfterCancelling = vi.fn(async <T>(action: () => Promise<T>) => action());
    vi.spyOn(bridge.runtime, "getSession").mockReturnValue({
      runExclusiveAfterCancelling,
    } as never);
    host.harness.listSessions.mockResolvedValueOnce([source] as never);
    host.harness.forkSession.mockResolvedValueOnce({ summary: target, close: vi.fn() });

    const result = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.ForkSession,
        params: { sessionId: "session-1", turnIndex: 0 },
      },
      "view-1",
    );

    expect(result).toEqual({ id: "rpc-1", result: { sessionId: "session-2" } });
    expect(runExclusiveAfterCancelling).toHaveBeenCalledOnce();
    expect(host.harness.forkSession).toHaveBeenCalledOnce();
  });

  it("closes and removes a fork when its baseline cannot be materialized", async () => {
    const source = { id: "session-1", workDir: root, updatedAt: 123 };
    const target = { id: "session-2", workDir: root, updatedAt: 124 };
    const close = vi.fn(async () => undefined);
    host.harness.listSessions.mockResolvedValueOnce([source] as never);
    host.harness.forkSession.mockResolvedValueOnce({ summary: target, close });
    vi.spyOn(bridge.baselineManager, "materializeToFork").mockRejectedValueOnce(
      new Error("baseline unavailable"),
    );
    const deleteBaseline = vi.spyOn(bridge.baselineManager, "deleteSession");

    const result = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.ForkSession,
        params: { sessionId: "session-1", turnIndex: 0 },
      },
      "view-1",
    );

    expect(result).toEqual({ id: "rpc-1", error: "baseline unavailable" });
    expect(close).toHaveBeenCalledOnce();
    expect(host.harness.deleteSession).toHaveBeenCalledWith("session-2");
    expect(deleteBaseline).toHaveBeenCalledWith("session-2");
  });

  it("keeps conversation history available when its baseline snapshot disappears", async () => {
    const session = createResumedSession("session-1", root);
    host.harness.resumeSession.mockResolvedValueOnce(session as never);
    host.showWarningMessage.mockResolvedValueOnce("Show Logs");
    const sourcePath = join(root, "app.ts");
    await writeFile(sourcePath, "original\n", "utf-8");
    await bridge.baselineManager.capture(session.summary, sourcePath);
    const baselinesRoot = join(root, "global-storage", "baselines");
    const [homeDirectory] = await readdir(baselinesRoot);
    const [sessionDirectory] = await readdir(join(baselinesRoot, homeDirectory!));
    const snapshotsDirectory = join(
      baselinesRoot,
      homeDirectory!,
      sessionDirectory!,
      "snapshots",
    );
    const [snapshot] = await readdir(snapshotsDirectory);
    await rm(join(snapshotsDirectory, snapshot!));

    const result = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.LoadSessionHistory,
        params: { sessionId: "session-1" },
      },
      "view-1",
    );

    expect(result).toEqual({
      id: "rpc-1",
      result: expect.arrayContaining([
        expect.objectContaining({ type: "StatusUpdate", _sessionId: "session-1" }),
      ]),
    });
    expect(writeLog).toHaveBeenCalledWith(
      expect.stringMatching(/Unable to restore session file changes.*Unable to read baseline snapshot/),
    );
    await vi.waitFor(() => expect(showLogs).toHaveBeenCalledOnce());
  });

  it("returns a readable error when persisted session state is corrupt without wedging the bridge", async () => {
    host.harness.resumeSession.mockRejectedValueOnce(
      new Error("Session state is invalid JSON at line 4"),
    );

    const failed = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.LoadSessionHistory,
        params: { sessionId: "session-1" },
      },
      "view-1",
    );
    const next = await bridge.handle({ id: "rpc-2", method: Methods.ShowLogs }, "view-1");

    expect(failed).toEqual({
      id: "rpc-1",
      error: "Session state is invalid JSON at line 4",
    });
    expect(writeLog).toHaveBeenCalledWith(
      expect.stringContaining("Session state is invalid JSON at line 4"),
    );
    expect(next).toEqual({ id: "rpc-2", result: { ok: true } });
  });
});

describe("Webview config saves (thinking effort persistence parity with the TUI)", () => {
  const effortModel = {
    provider: "managed:kimi-code",
    model: "reasoning",
    supportEfforts: ["low", "high", "max"],
    defaultEffort: "high",
  };

  function mockConfig(thinking?: { mode?: string; effort?: string }) {
    host.harness.getConfig.mockResolvedValue({
      defaultModel: "kimi/reasoning",
      thinking: thinking ?? { mode: "on", effort: "high" },
      models: { "kimi/reasoning": effortModel },
    } as never);
  }

  it("persists a non-top effort as the global default", async () => {
    mockConfig({ mode: "off", effort: "low" });

    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.SaveConfig, params: { model: "kimi/reasoning", thinking: true, effort: "high" } },
      "view-1",
    );

    expect(result).toEqual({ id: "rpc-1", result: { ok: true } });
    expect(host.harness.setConfig).toHaveBeenCalledWith({
      defaultModel: "kimi/reasoning",
      thinking: { mode: "on", effort: "high" },
    });
  });

  it("keeps the model's top declared tier session-only", async () => {
    mockConfig({ mode: "off" });

    await bridge.handle(
      { id: "rpc-1", method: Methods.SaveConfig, params: { model: "kimi/reasoning", thinking: true, effort: "max" } },
      "view-1",
    );

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      defaultModel: "kimi/reasoning",
      thinking: { mode: "on", effort: "max" },
    });
  });

  it("persists the concrete effort when the model's levels are unknown", async () => {
    host.harness.getConfig.mockResolvedValue({ defaultModel: "other/model", models: {} });

    await bridge.handle(
      { id: "rpc-1", method: Methods.SaveConfig, params: { model: "custom/model", thinking: true, effort: "max" } },
      "view-1",
    );

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      defaultModel: "custom/model",
      thinking: { mode: "on", effort: "max" },
    });
  });

  it("leaves the stored effort alone when the pick re-confirms the active effort", async () => {
    mockConfig({ mode: "off", effort: "high" });

    await bridge.handle(
      { id: "rpc-1", method: Methods.SaveConfig, params: { model: "kimi/reasoning", thinking: true, effort: "high", effortChanged: false } },
      "view-1",
    );

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      defaultModel: "kimi/reasoning",
      thinking: { mode: "on" },
    });
  });

  it("skips the config write entirely when nothing changed", async () => {
    mockConfig({ mode: "on", effort: "high" });

    await bridge.handle(
      { id: "rpc-1", method: Methods.SaveConfig, params: { model: "kimi/reasoning", thinking: true, effort: "high" } },
      "view-1",
    );

    expect(host.harness.setConfig).not.toHaveBeenCalled();
  });
});

function createResumedSession(id: string, workDir: string) {
  const close = vi.fn(async () => undefined);
  const summary = {
    id,
    workDir,
    sessionDir: join("/private/pythinker/sessions", id),
    createdAt: 1,
    updatedAt: 2,
    metadata: { vscode_permission_mode: "manual" },
  };
  return {
    id,
    workDir,
    summary,
    close,
    getResumeState: () => ({
      sessionMetadata: { agents: {} },
      agents: {
        main: {
          type: "main",
          config: {
            cwd: workDir,
            modelAlias: "test-model",
            modelCapabilities: {
              image_in: false,
              video_in: false,
              audio_in: false,
              thinking: false,
              tool_use: true,
              max_context_tokens: 128_000,
            },
            thinkingEffort: "off",
            systemPrompt: "",
          },
          context: { history: [], tokenCount: 0 },
          replay: [],
          permission: { mode: "manual", rules: [] },
          plan: null,
          usage: {},
          tools: [],
          background: [],
        },
      },
    }),
    getStatus: async () => ({ permission: "manual" }),
    setPermission: async () => undefined,
    getSessionMetadata: async () => ({ custom: {} }),
    updateSessionMetadata: async () => undefined,
    setApprovalHandler: () => undefined,
    setQuestionHandler: () => undefined,
    onEvent: () => () => undefined,
  };
}

describe("Webview provider management (writes the same config.toml the CLI reads)", () => {
  const catalog = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      api: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: { m1: { id: "m1", name: "M1", limit: { context: 200000, output: 64000 } } },
    },
    unusable: { id: "unusable", name: "Unusable", models: {} },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists configured providers without ever sending the API key", async () => {
    host.harness.getConfig.mockResolvedValue({
      providers: { anthropic: { type: "anthropic", apiKey: "sk-secret", baseUrl: "https://api.anthropic.com" } },
      models: { "anthropic/m1": { provider: "anthropic", model: "m1" } },
      defaultModel: "anthropic/m1",
    } as never);

    const response = await bridge.handle({ id: "rpc-1", method: Methods.GetProviders }, "view-1");

    const result = (response as { result: any }).result;
    expect(result.providers).toEqual([
      expect.objectContaining({ id: "anthropic", keySource: "config", models: ["anthropic/m1"] }),
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("offers only catalog providers that a single key can reach", async () => {
    const response = await bridge.handle({ id: "rpc-1", method: Methods.GetProviderCatalog }, "view-1");

    const result = (response as { result: any }).result;
    expect(result.map((entry: any) => entry.id)).toEqual(["anthropic"]);
    expect(result[0].models).toEqual([expect.objectContaining({ id: "m1" })]);
  });

  it("imports a catalog provider into the config", async () => {
    host.harness.getConfig.mockResolvedValue({ providers: {} } as never);

    const response = await bridge.handle(
      {
        id: "rpc-1",
        method: Methods.AddCatalogProvider,
        params: { providerId: "anthropic", apiKey: "sk-test", defaultModel: "m1" },
      },
      "view-1",
    );

    expect((response as { error?: unknown }).error).toBeUndefined();
    expect(host.harness.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          anthropic: expect.objectContaining({ apiKey: "sk-test" }),
        }),
        defaultModel: "anthropic/m1",
      }),
    );
  });

  it("rejects an import with no key rather than writing a broken provider", async () => {
    host.harness.getConfig.mockResolvedValue({ providers: {} } as never);

    const response = await bridge.handle(
      { id: "rpc-1", method: Methods.AddCatalogProvider, params: { providerId: "anthropic" } },
      "view-1",
    );

    expect((response as { error?: string }).error).toMatch(/needs an API key/);
    expect(host.harness.setConfig).not.toHaveBeenCalled();
  });

  it("removes a provider through the harness", async () => {
    host.harness.getConfig.mockResolvedValue({ providers: {} } as never);

    await bridge.handle(
      { id: "rpc-1", method: Methods.RemoveProvider, params: { providerId: "anthropic" } },
      "view-1",
    );

    expect(host.harness.removeProvider).toHaveBeenCalledWith("anthropic");
  });
});
