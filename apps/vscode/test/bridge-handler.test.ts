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

import { Events, Methods } from "../shared/bridge";
import { BridgeHandler } from "../src/bridge-handler";
import { loginOutcomeState } from "../webview-ui/src/components/login-outcome";

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
    isAuthenticated: vi.fn(async () => false),
  };
  const showWarningMessage = vi.fn(async () => undefined as string | undefined);
  const showQuickPick = vi.fn();
  const showInputBox = vi.fn();
  const showInformationMessage = vi.fn();
  const showErrorMessage = vi.fn();
  // Minimal stand-in for VS Code's own token source: enough to observe that a
  // token was handed to a prompt, and to fire the cancellation listeners.
  class CancellationTokenSource {
    private readonly listeners: Array<() => void> = [];
    readonly token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      },
    };

    cancel(): void {
      this.token.isCancellationRequested = true;
      for (const listener of this.listeners) listener();
    }

    dispose(): void {}
  }
  const withProgress = vi.fn(
    async (
      _options: unknown,
      task: (progress: unknown, token: unknown) => Promise<unknown>,
    ) => task({ report: vi.fn() }, new CancellationTokenSource().token),
  );
  // Typed to match the real `env.openExternal`, so a test can read back the URI
  // it was handed rather than an empty argument tuple.
  const openExternal = vi.fn(async (_target: Uri) => true);
  const executeCommand = vi.fn(async () => undefined);

  class Uri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;

    constructor(
      readonly fsPath: string,
      parts?: { scheme: string; authority: string; path: string },
    ) {
      this.scheme = parts?.scheme ?? "file";
      this.authority = parts?.authority ?? "";
      this.path = parts?.path ?? fsPath;
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
      return new Uri(join(base.fsPath, ...segments));
    }

    // Keeps the scheme the caller parsed. Collapsing every input to `file:`
    // hid what `openExternal` actually received, which is the one thing an
    // OAuth assertion needs to see.
    static parse(input: string): Uri {
      const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/iu.exec(input);
      if (match === null) return new Uri(input);
      return new Uri(input, {
        scheme: match[1]!.toLowerCase(),
        authority: match[2]!,
        path: match[3]!,
      });
    }

    toString(): string {
      return this.scheme === "file" && this.authority === ""
        ? `file://${this.path}`
        : `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  return {
    Uri,
    CancellationTokenSource,
    watcher,
    harness,
    showWarningMessage,
    showQuickPick,
    showInputBox,
    showInformationMessage,
    showErrorMessage,
    withProgress,
    openExternal,
    executeCommand,
    workspaceFolders: [] as Array<{ uri: Uri }>,
  };
});

vi.mock("vscode", () => ({
  Uri: host.Uri,
  CancellationTokenSource: host.CancellationTokenSource,
  workspace: {
    get workspaceFolders() {
      return host.workspaceFolders;
    },
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    createFileSystemWatcher: () => host.watcher,
    textDocuments: [],
  },
  window: {
    showWarningMessage: host.showWarningMessage,
    showQuickPick: host.showQuickPick,
    showInputBox: host.showInputBox,
    showInformationMessage: host.showInformationMessage,
    showErrorMessage: host.showErrorMessage,
    withProgress: host.withProgress,
  },
  env: { openExternal: host.openExternal },
  commands: { executeCommand: host.executeCommand },
  ProgressLocation: { Notification: 15 },
}));

vi.mock("@pythoughts/pythinker-code-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pythoughts/pythinker-code-sdk")>();
  return { ...original, createPythinkerHarness: () => host.harness };
});

let bridge: BridgeHandler;
let root: string;
let broadcast: Mock;
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
  host.harness.isAuthenticated.mockReset();
  host.harness.isAuthenticated.mockResolvedValue(false);
  host.showWarningMessage.mockReset();
  host.showWarningMessage.mockResolvedValue(undefined);
  host.showQuickPick.mockReset();
  host.showInputBox.mockReset();
  host.showInformationMessage.mockReset();
  host.showErrorMessage.mockReset();
  host.withProgress.mockReset();
  host.withProgress.mockImplementation(
    async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
      task({ report: vi.fn() }, new host.CancellationTokenSource().token),
  );
  host.openExternal.mockReset();
  host.openExternal.mockResolvedValue(true);
  host.executeCommand.mockReset();
  host.executeCommand.mockResolvedValue(undefined);
  workspaceState = { get: vi.fn((_key, fallback) => fallback), update: vi.fn() };
  broadcast = vi.fn();
  bridge = new BridgeHandler(
    broadcast,
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

  it("changes the permission mode of a running session without starting a turn", async () => {
    const setPermissionMode = vi.fn(async () => undefined);
    vi.spyOn(bridge.runtime, "getSessionForView").mockReturnValue({
      permissionMode: "manual",
      setPermissionMode,
      beginHostAction: () => {
        throw new Error("A host action must not frame a permission change");
      },
    } as never);

    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.SetPermissionMode, params: { mode: "yolo", request: "on" } },
      "view-1",
    );

    expect(setPermissionMode).toHaveBeenCalledWith("yolo");
    expect(result).toMatchObject({ id: "rpc-1", result: { ok: true, mode: "yolo" } });
  });

  it("rejects a permission change for a mode it does not control", async () => {
    const result = await bridge.handle(
      { id: "rpc-1", method: Methods.SetPermissionMode, params: { mode: "plan", request: "on" } },
      "view-1",
    );

    expect(result).toEqual({
      id: "rpc-1",
      error: "Invalid bridge params for method: setPermissionMode",
    });
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
    provider: "moonshot-cn",
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

const CATALOG_RESPONSE = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    api: "https://api.anthropic.com",
    env: ["PYTHINKER_TEST_ANTHROPIC_KEY"],
    models: {
      "claude-opus-4-7": {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        limit: { context: 200_000, output: 64_000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
};

// The single-flight guard behind Methods.Login is module state, held for as
// long as a login runs. A test that hangs never releases it, so every later
// login here joins the hung one and times out too: when several of these fail
// at once, fix the first and the rest usually go with it.
describe("Webview login (multi-provider picker behind Methods.Login)", () => {
  beforeEach(() => {
    // Default to an unreachable models.dev: login must fall back to the bundled
    // catalog seed and still offer the built-in OAuth platforms. Tests that
    // exercise a catalog provider stub a live response over this.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the picked provider's credentials and reports success", async () => {
    // A live catalog, so the API-key flow runs end to end: provider pick, key
    // entry, model pick, effort pick.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => CATALOG_RESPONSE,
      })),
    );
    host.harness.getConfig.mockResolvedValue({ providers: {}, models: {} } as never);
    host.showInputBox.mockResolvedValue("sk-typed-in" as never);

    let offeredEffortLevels: string[] = [];
    host.showQuickPick
      .mockImplementationOnce(
        async (items: Array<{ value: string }>) =>
          items.find((item) => item.value === "catalog:anthropic"),
      )
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockImplementationOnce(async (items: Array<{ label: string }>) => {
        offeredEffortLevels = items.map((item) => item.label);
        return items.find((item) => item.label === "medium");
      });

    const result = await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    expect(result).toEqual({ id: "rpc-login", result: { success: true } });
    const platformItems = host.showQuickPick.mock.calls[0]?.[0] as Array<{ label: string }>;
    expect(platformItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(["OpenAI Codex (OAuth)", "Anthropic"]),
    );
    // The effort levels come from the SDK's shared rule, so the extension
    // offers exactly what the terminal renderer offers for the same model.
    // `claude-opus-4-7` declares reasoning and no `supportEfforts`, which is
    // the low/medium/high fallback plus the `off` toggle.
    expect(offeredEffortLevels).toEqual(["off", "low", "medium", "high"]);
    expect(host.harness.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          anthropic: expect.objectContaining({ apiKey: "sk-typed-in" }),
        }),
        defaultModel: "anthropic/claude-opus-4-7",
        // The picked level, not just the on/off bit: the patch used to omit
        // `thinking`, so every session reopened at the default effort.
        defaultThinking: true,
        thinking: expect.objectContaining({ effort: "medium" }),
      }),
    );
  });

  it("still offers the built-in OAuth platforms when the live catalog is unreachable", async () => {
    host.showQuickPick.mockResolvedValue(undefined as never);

    await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    // Offline is a benign fallback, not a failure: the picker still opens with
    // the built-in OAuth platforms and no error toast is shown.
    const platformItems = host.showQuickPick.mock.calls[0]?.[0] as Array<{ label: string }>;
    expect(platformItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(["OpenAI Codex (OAuth)"]),
    );
    expect(host.showErrorMessage).not.toHaveBeenCalled();
    expect(host.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Using bundled provider catalog"),
    );
  });


  it("reports cancellation without writing config when the picker is dismissed", async () => {
    host.showQuickPick.mockResolvedValue(undefined as never);

    const result = await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    // No `error` field: the webview renders a cancellation as idle, not as a
    // failed login.
    expect(result).toEqual({ id: "rpc-login", result: { success: false } });
    expect(host.harness.setConfig).not.toHaveBeenCalled();
  });

  it("renders a dismissed picker as idle, and only a real failure as an error", () => {
    // Before login was multi-provider this branch was unreachable, so a
    // cancelled picker used to fall through to the "Login failed" screen.
    expect(loginOutcomeState({ success: false })).toEqual({ state: "idle", error: null });
    expect(loginOutcomeState({ success: false, error: "boom" })).toEqual({
      state: "error",
      error: "boom",
    });
  });

  it("opens one cancellable progress notification and hands its token to every prompt", async () => {
    // Driven all the way through the credential flow rather than dismissed at
    // the picker: a token that only reaches the first widget still strands the
    // user on the key, model, and effort prompts.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => CATALOG_RESPONSE,
      })),
    );
    host.harness.getConfig.mockResolvedValue({ providers: {}, models: {} } as never);
    host.showInputBox.mockResolvedValue("sk-typed-in" as never);
    host.showQuickPick
      .mockImplementationOnce(
        async (items: Array<{ value: string }>) =>
          items.find((item) => item.value === "catalog:anthropic"),
      )
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockImplementationOnce(async (items: Array<{ label: string }>) =>
        items.find((item) => item.label === "medium"),
      );

    await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    // The OAuth flows wait minutes on a browser round trip with no spinner of
    // their own, so this notification is the only way out of them.
    const loginProgress = host.withProgress.mock.calls.find(
      (call) => (call[0] as { title?: string }).title === "Signing in to Pythinker",
    );
    expect(loginProgress?.[0]).toMatchObject({ cancellable: true });

    // The token has to reach each prompt itself: cancelling has to close the
    // widget the user is looking at, not just abort a background fetch.
    // Provider, model, and effort pickers, then the API-key box.
    expect(host.showQuickPick).toHaveBeenCalledTimes(3);
    for (const call of host.showQuickPick.mock.calls) {
      expect(call[2]).toBeDefined();
    }
    expect(host.showInputBox).toHaveBeenCalled();
    for (const call of host.showInputBox.mock.calls) {
      expect(call[1]).toBeDefined();
    }
  });

  it("cancelling the progress notification aborts the catalog fetch", async () => {
    // A catalog fetch that only ever settles by being aborted: without a cancel
    // path this login hangs there and the picker never opens.
    let abortSignal: AbortSignal | undefined;
    let fetchEntered: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      fetchEntered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
        abortSignal = init.signal;
        fetchEntered();
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      }),
    );
    host.showQuickPick.mockResolvedValue(undefined as never);
    host.withProgress.mockImplementation(
      async (
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<unknown>,
      ) => {
        const source = new host.CancellationTokenSource();
        const running = task({ report: vi.fn() }, source.token);
        // Cancel once the flow is parked on the catalog fetch.
        await fetchStarted;
        source.cancel();
        return running;
      },
    );

    const result = await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    expect(abortSignal?.aborted).toBe(true);
    expect(result).toEqual({ id: "rpc-login", result: { success: false } });
    expect(host.harness.setConfig).not.toHaveBeenCalled();
  });

  it("joins a concurrent login instead of opening a second set of prompts", async () => {
    let openPickers = 0;
    host.showQuickPick.mockImplementation(async () => {
      openPickers += 1;
      return undefined;
    });

    const [first, second] = await Promise.all([
      bridge.handle({ id: "rpc-login-1", method: Methods.Login }, "view-1"),
      bridge.handle({ id: "rpc-login-2", method: Methods.Login }, "view-1"),
    ]);

    // Two flows would race to write credentials behind two competing pickers.
    expect(openPickers).toBe(1);
    expect(first).toEqual({ id: "rpc-login-1", result: { success: false } });
    expect(second).toEqual({ id: "rpc-login-2", result: { success: false } });

    // The slot is released, so a later login still runs.
    await bridge.handle({ id: "rpc-login-3", method: Methods.Login }, "view-1");
    expect(openPickers).toBe(2);
  });

  it("keeps a completed login successful when the status refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => CATALOG_RESPONSE })),
    );
    host.harness.getConfig.mockResolvedValue({ providers: {}, models: {} } as never);
    host.showInputBox.mockResolvedValue("sk-typed-in" as never);
    host.showQuickPick
      .mockImplementationOnce(
        async (items: Array<{ value: string }>) =>
          items.find((item) => item.value === "catalog:anthropic"),
      )
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockImplementationOnce(async (items: Array<{ label: string }>) =>
        items.find((item) => item.label === "medium"),
      );
    // The refresh runs after credentials are already on disk, so its failure is
    // a stale badge — reporting it as a failed login would send the user back
    // to the sign-in screen they just completed.
    host.harness.isAuthenticated.mockRejectedValue(new Error("status backend down") as never);

    const result = await bridge.handle({ id: "rpc-login", method: Methods.Login }, "view-1");

    expect(result).toEqual({ id: "rpc-login", result: { success: true } });
    // The refresh has to have been attempted — otherwise this asserts nothing
    // about a failure it never reached.
    expect(host.harness.isAuthenticated).toHaveBeenCalledTimes(1);
    expect(host.harness.setConfig).toHaveBeenCalled();
  });
});
