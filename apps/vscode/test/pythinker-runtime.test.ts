/**
 * Scenario: the VS Code host owns one Pythinker harness and routes Webviews to shared SDK sessions.
 * Responsibilities: create/resume/switch, per-session settings, multi-view ownership, detach, and disposal.
 * Wiring: PythinkerRuntime and SessionRuntime are real; in-memory Session/PythinkerHarness fakes form the public SDK boundary.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/pythinker-runtime.test.ts
 */

import type {
  ApprovalHandler,
  CreateSessionOptions,
  Event,
  JsonObject,
  PythinkerHarness,
  PermissionMode,
  PromptInput,
  QuestionHandler,
  ResumeSessionInput,
  Session,
  SessionStatus,
  SessionSummary,
} from "@pymodel/pythinker-code-sdk";
import { describe, expect, it, vi } from "vitest";

type ThinkingEffort = string;

import { Events } from "../shared/bridge";
import { PythinkerRuntime, type OpenSessionOptions } from "../src/runtime/pythinker-runtime";

const sdkFactories = vi.hoisted(() => {
  const v2Harness = { homeDir: "/tmp/pythinker-runtime-v2-home", close: vi.fn(async () => undefined) };
  return {
    v2Harness,
    createPythinkerHarnessV2: vi.fn(() => v2Harness),
  };
});

vi.mock("@pymodel/pythinker-code-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pymodel/pythinker-code-sdk")>();
  return {
    ...original,
    createPythinkerHarnessV2: sdkFactories.createPythinkerHarnessV2,
  };
});

interface FakeSessionBoundary {
  readonly session: Session;
  readonly setModels: string[];
  readonly setThinkingEfforts: ThinkingEffort[];
  readonly setPermissions: PermissionMode[];
  readonly metadataUpdates: JsonObject[];
  readonly handlerInstallations: { approval: number; question: number };
  readonly subscriptionCount: () => number;
  readonly closeCount: () => number;
  readonly emit: (event: Event) => void;
  readonly setPromptImpl: (impl: (input: string | PromptInput) => Promise<void>) => void;
}

function createFakeSession(
  id: string,
  workDir: string,
  initial: Partial<SessionStatus> = {},
  metadata?: JsonObject,
): FakeSessionBoundary {
  const listeners = new Set<(event: Event) => void>();
  const setModels: string[] = [];
  const setThinkingEfforts: ThinkingEffort[] = [];
  const setPermissions: PermissionMode[] = [];
  const metadataUpdates: JsonObject[] = [];
  const handlerInstallations = { approval: 0, question: 0 };
  let subscriptions = 0;
  let closes = 0;
  let promptImpl: (input: string | PromptInput) => Promise<void> = async () => {};
  let status: SessionStatus = {
    model: initial.model ?? "kimi-test",
    thinkingEffort: initial.thinkingEffort ?? "off",
    permission: initial.permission ?? "manual",
    planMode: initial.planMode ?? false,
    dynamicWorkflowMode: false,
    contextTokens: 0,
    maxContextTokens: 128_000,
    contextUsage: 0,
  };
  let summary: SessionSummary = {
    id,
    workDir,
    sessionDir: `/home/sessions/${id}`,
    createdAt: 1,
    updatedAt: 2,
    metadata,
  };

  const session = {
    id,
    workDir,
    get summary() {
      return summary;
    },
    set summary(value: SessionSummary | undefined) {
      if (value !== undefined) summary = value;
    },
    setApprovalHandler(handler: ApprovalHandler | undefined) {
      if (handler !== undefined) handlerInstallations.approval += 1;
    },
    setQuestionHandler(handler: QuestionHandler | undefined) {
      if (handler !== undefined) handlerInstallations.question += 1;
    },
    onEvent(listener: (event: Event) => void) {
      subscriptions += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(input: string | PromptInput) {
      await promptImpl(input);
    },
    async steer(_input: string | PromptInput) {},
    async cancel() {},
    async getStatus() {
      return status;
    },
    async setModel(model: string) {
      setModels.push(model);
      status = { ...status, model };
    },
    async setThinking(effort: ThinkingEffort) {
      setThinkingEfforts.push(effort);
      status = { ...status, thinkingEffort: effort };
    },
    async setPermission(permission: PermissionMode) {
      setPermissions.push(permission);
      status = { ...status, permission };
    },
    async updateMetadata(patch: JsonObject) {
      metadataUpdates.push(patch);
      summary = { ...summary, metadata: { ...summary.metadata, ...patch } };
    },
    async close() {
      closes += 1;
    },
  } as unknown as Session;

  return {
    session,
    setModels,
    setThinkingEfforts,
    setPermissions,
    metadataUpdates,
    handlerInstallations,
    subscriptionCount: () => subscriptions,
    closeCount: () => closes,
    emit: (event: Event) => {
      for (const listener of [...listeners]) listener(event);
    },
    setPromptImpl: (impl) => {
      promptImpl = impl;
    },
  };
}

interface FakeHarnessBoundary {
  readonly harness: PythinkerHarness;
  readonly createInputs: CreateSessionOptions[];
  readonly resumeInputs: ResumeSessionInput[];
  readonly closeSessionIds: string[];
  readonly deleteSessionIds: string[];
  readonly closeCount: () => number;
  readonly sessions: Map<string, FakeSessionBoundary>;
  addSession(
    id: string,
    workDir: string,
    initial?: Partial<SessionStatus>,
    metadata?: JsonObject,
  ): FakeSessionBoundary;
}

function createFakeHarness(
  normalizeCreatedWorkDir: (workDir: string) => string = (workDir) => workDir,
): FakeHarnessBoundary {
  const sessions = new Map<string, FakeSessionBoundary>();
  const createInputs: CreateSessionOptions[] = [];
  const resumeInputs: ResumeSessionInput[] = [];
  const closeSessionIds: string[] = [];
  const deleteSessionIds: string[] = [];
  let creates = 0;
  let closes = 0;

  const addSession = (
    id: string,
    workDir: string,
    initial?: Partial<SessionStatus>,
    metadata?: JsonObject,
  ) => {
    const boundary = createFakeSession(id, workDir, initial, metadata);
    sessions.set(id, boundary);
    return boundary;
  };

  const harness = {
    async createSession(options: CreateSessionOptions) {
      createInputs.push(options);
      creates += 1;
      return addSession(
        `created-${creates}`,
        normalizeCreatedWorkDir(options.workDir),
        {
          model: options.model,
          thinkingEffort: options.thinking ?? "off",
          permission: options.permission,
        },
        options.metadata,
      ).session;
    },
    async resumeSession(input: ResumeSessionInput) {
      resumeInputs.push(input);
      const boundary = sessions.get(input.id);
      if (boundary === undefined) throw new Error(`Unknown session: ${input.id}`);
      return boundary.session;
    },
    async closeSession(id: string) {
      closeSessionIds.push(id);
    },
    async deleteSession(id: string) {
      deleteSessionIds.push(id);
    },
    async close() {
      closes += 1;
    },
  } as unknown as PythinkerHarness;

  return {
    harness,
    createInputs,
    resumeInputs,
    closeSessionIds,
    deleteSessionIds,
    closeCount: () => closes,
    sessions,
    addSession,
  };
}

function openOptions(overrides: Partial<OpenSessionOptions> = {}): OpenSessionOptions {
  return {
    webviewId: "view-1",
    workDir: "/workspace",
    model: "kimi-test",
    effort: "off",
    yoloMode: false,
    ...overrides,
  };
}

function createRuntime(
  normalizeCreatedWorkDir?: (workDir: string) => string,
) {
  const sdk = createFakeHarness(normalizeCreatedWorkDir);
  const runtime = new PythinkerRuntime({
    version: "0.6.0",
    harness: sdk.harness,
    broadcast: () => undefined,
    captureBaseline: () => undefined,
    log: () => undefined,
  });
  return { runtime, sdk };
}

describe("Pythinker runtime (owns shared SDK sessions for Webviews)", () => {
  it("creates the v2 harness", async () => {
    const defaults = new PythinkerRuntime({
      version: "0.6.0",
      broadcast: () => undefined,
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    expect(sdkFactories.createPythinkerHarnessV2).toHaveBeenCalledOnce();
    expect(sdkFactories.createPythinkerHarnessV2).toHaveBeenCalledWith({
      homeDir: undefined,
      identity: {
        productName: "pythinker-code-vscode",
        version: "0.6.0",
        platform: "pythinker_code_vscode",
      },
      uiMode: "vscode",
    });
    expect(defaults.harness).toBe(sdkFactories.v2Harness as unknown as PythinkerHarness);
    await defaults.dispose();
  });

  it("forwards the requested settings when creating an SDK session", async () => {
    const { runtime, sdk } = createRuntime();

    const opened = await runtime.openSession(
      openOptions({ model: "kimi-k2", effort: "high", yoloMode: true }),
    );

    expect(sdk.createInputs).toEqual([
      {
        workDir: "/workspace",
        model: "kimi-k2",
        thinking: "high",
        permission: "yolo",
        metadata: { vscode_permission_mode: "yolo" },
      },
    ]);
    expect(opened.subscribers).toEqual(["view-1"]);
  });

  it("accepts the normalized SDK workDir when a Windows session is created", async () => {
    const { runtime } = createRuntime((workDir) => workDir.replaceAll("\\", "/"));

    const opened = await runtime.openSession(openOptions({
      workDir: "C:\\Users\\Example User\\\u9879\u76EE",
    }));

    expect(opened.session.workDir).toBe("C:/Users/Example User/\u9879\u76EE");
  });

  it("resumes a Windows session when only separators and casing differ", async () => {
    const { runtime, sdk } = createRuntime();
    sdk.addSession("saved-win", "C:/Users/Example User/\u9879\u76EE");

    const opened = await runtime.openSession(openOptions({
      sessionId: "saved-win",
      workDir: "c:\\users\\example user\\\u9879\u76EE",
    }));

    expect(opened.id).toBe("saved-win");
  });

  it("uses off thinking when a new session receives an empty effort", async () => {
    const { runtime, sdk } = createRuntime();

    await runtime.openSession(openOptions({ effort: "   " }));

    expect(sdk.createInputs[0]?.thinking).toBe("off");
  });

  it("resumes the requested SDK session instead of creating a replacement", async () => {
    const { runtime, sdk } = createRuntime();
    sdk.addSession("saved-1", "/workspace");

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1" }));

    expect(opened.id).toBe("saved-1");
    expect(sdk.resumeInputs).toEqual([{ id: "saved-1", includeSubagents: true }]);
    expect(sdk.createInputs).toEqual([]);
  });

  it("switches a Webview to the requested session", async () => {
    const { runtime, sdk } = createRuntime();
    await runtime.openSession(openOptions());
    sdk.addSession("saved-2", "/workspace");

    const selected = await runtime.openSession(openOptions({ sessionId: "saved-2" }));

    expect(runtime.getSessionForView("view-1")?.id).toBe("saved-2");
    expect(selected.id).toBe("saved-2");
  });

  it("closes an unshared old session when its Webview switches away", async () => {
    const { runtime, sdk } = createRuntime();
    const old = await runtime.openSession(openOptions());
    const oldBoundary = sdk.sessions.get(old.id)!;
    sdk.addSession("saved-2", "/workspace");

    await runtime.openSession(openOptions({ sessionId: "saved-2" }));

    expect(oldBoundary.closeCount()).toBe(1);
  });

  it("shares one SDK subscription when two Webviews attach to the same session", async () => {
    const { runtime, sdk } = createRuntime();
    const first = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    const boundary = sdk.sessions.get(first.id)!;

    const second = await runtime.openSession(
      openOptions({ webviewId: "view-2", sessionId: first.id }),
    );

    expect(second).toBe(first);
    expect(first.subscribers).toEqual(["view-1", "view-2"]);
    expect(boundary.subscriptionCount()).toBe(1);
    expect(boundary.handlerInstallations).toEqual({ approval: 1, question: 1 });
  });

  it("preserves the resumed session's model instead of reapplying the configured default", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { model: "old-model" });

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", model: "new-model" }));

    expect(session.setModels).toEqual([]);
    await expect(opened.session.getStatus()).resolves.toMatchObject({ model: "old-model" });
  });

  it("preserves the resumed session's thinking effort instead of reapplying the configured default", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { thinkingEffort: "max" });

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", effort: "medium" }));

    expect(session.setThinkingEfforts).toEqual([]);
    await expect(opened.session.getStatus()).resolves.toMatchObject({ thinkingEffort: "max" });
  });

  it("announces the session's actual status to the attaching view so the display matches it", async () => {
    const sdk = createFakeHarness();
    const broadcasts: { event: string; data: unknown; webviewId?: string }[] = [];
    const runtime = new PythinkerRuntime({
      version: "0.6.0",
      harness: sdk.harness,
      broadcast: (event: string, data: unknown, webviewId?: string) => {
        broadcasts.push({ event, data, webviewId });
      },
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    sdk.addSession("saved-1", "/workspace", {
      model: "kimi-test",
      thinkingEffort: "max",
      planMode: true,
    });

    await runtime.openSession(openOptions({ sessionId: "saved-1", effort: "medium" }));

    expect(broadcasts).toContainEqual({
      event: Events.StreamEvent,
      data: {
        type: "StatusUpdate",
        // The permission mode rides along: the chat badge is the only place the
        // user can see which mode a toggle command just landed on.
        payload: {
          model: "kimi-test",
          thinking_effort: "max",
          plan_mode: true,
          permission: "manual",
          context_usage: 0,
        },
        _sessionId: "saved-1",
      },
      webviewId: "view-1",
    });
  });

  it("announces the new permission mode so the chat badge can show it", async () => {
    const sdk = createFakeHarness();
    const broadcasts: { event: string; data: unknown; webviewId?: string }[] = [];
    const runtime = new PythinkerRuntime({
      version: "0.6.0",
      harness: sdk.harness,
      broadcast: (event: string, data: unknown, webviewId?: string) => {
        broadcasts.push({ event, data, webviewId });
      },
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    sdk.addSession("saved-1", "/workspace", { permission: "manual" });
    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1" }));

    broadcasts.length = 0;
    await opened.setPermissionMode("yolo");

    // `/yolo` toggles, so a mode the chat cannot see is a command that silently
    // does the opposite of what the user meant.
    expect(broadcasts).toContainEqual({
      event: Events.StreamEvent,
      data: {
        type: "StatusUpdate",
        payload: {
          model: "kimi-test",
          thinking_effort: "off",
          plan_mode: false,
          permission: "yolo",
          context_usage: 0,
        },
        _sessionId: "saved-1",
      },
      webviewId: "view-1",
    });
  });

  it("seeds an unmarked resumed session from the yolo setting", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { permission: "manual" });

    await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    expect(session.metadataUpdates).toEqual([{ vscode_permission_mode: "yolo" }]);
  });

  it("keeps a stored yolo mode when the global setting is off", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_permission_mode: "yolo" },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: false }));

    expect(session.setPermissions).toEqual(["yolo"]);
    expect(session.metadataUpdates).toEqual([]);
    expect(opened.permissionMode).toBe("yolo");
  });

  it("keeps a stored manual mode when the global setting is on", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_permission_mode: "manual" },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    expect(session.setPermissions).toEqual([]);
    expect(session.metadataUpdates).toEqual([]);
    expect(opened.permissionMode).toBe("manual");
  });

  it("restores a stored auto mode", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_permission_mode: "auto" },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: false }));

    expect(session.setPermissions).toEqual(["auto"]);
    expect(opened.permissionMode).toBe("auto");
  });

  it("ignores an unrecognised stored mode and falls back to the setting", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession(
      "saved-1",
      "/workspace",
      { permission: "manual" },
      { vscode_permission_mode: "nonsense" },
    );

    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: true }));

    expect(opened.permissionMode).toBe("yolo");
    expect(session.metadataUpdates).toEqual([{ vscode_permission_mode: "yolo" }]);
  });

  it("applies an explicit settings change to the live sessions", async () => {
    const { runtime } = createRuntime();
    const opened = await runtime.openSession(openOptions());

    await runtime.setPermissionModeForActiveSessions("yolo");

    expect(opened.permissionMode).toBe("yolo");
    await expect(opened.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });
  });

  it("applies a permission mode requested before the view had a session", async () => {
    const { runtime } = createRuntime();
    const target = runtime.pendingPermissionTarget("view-1", "manual");

    expect(await target.togglePermissionMode("yolo")).toBe("yolo");
    const opened = await runtime.openSession(openOptions({ webviewId: "view-1" }));

    expect(opened.permissionMode).toBe("yolo");
    await expect(opened.session.getStatus()).resolves.toMatchObject({ permission: "yolo" });
    // Consumed once: the next session opened by that view starts from its own mode.
    expect(runtime.pendingPermissionTarget("view-1", "manual").permissionMode).toBe("manual");
  });

  it("keeps a pending permission mode when applying it to the session fails", async () => {
    const { runtime, sdk } = createRuntime();
    const boundary = sdk.addSession("saved-1", "/workspace");
    (boundary.session as { setPermission: (mode: PermissionMode) => Promise<void> }).setPermission =
      async () => {
        throw new Error("engine offline");
      };
    await runtime.pendingPermissionTarget("view-1", "manual").setPermissionMode("yolo");

    await expect(
      runtime.openSession(openOptions({ webviewId: "view-1", sessionId: "saved-1" })),
    ).rejects.toThrow("engine offline");

    expect(runtime.pendingPermissionTarget("view-1", "manual").permissionMode).toBe("yolo");
  });

  it("persists a mode change so the next attach restores it", async () => {
    const { runtime, sdk } = createRuntime();
    const session = sdk.addSession("saved-1", "/workspace", { permission: "manual" });
    const opened = await runtime.openSession(openOptions({ sessionId: "saved-1", yoloMode: false }));

    await opened.setPermissionMode("yolo");

    expect(session.metadataUpdates.at(-1)).toEqual({ vscode_permission_mode: "yolo" });
  });

  it("keeps a shared session open when one of its Webviews detaches", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: opened.id }));
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.detachView("view-1");

    expect(boundary.closeCount()).toBe(0);
    expect(runtime.getSessionForView("view-2")?.id).toBe(opened.id);
  });

  it("closes an SDK session when its last Webview detaches", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.detachView("view-1");

    expect(boundary.closeCount()).toBe(1);
    expect(runtime.getSession(opened.id)).toBeUndefined();
  });

  it("reattaches the same resumed session without replacing its handlers", async () => {
    const { runtime, sdk } = createRuntime();
    const boundary = sdk.addSession("saved-1", "/workspace");
    const first = await runtime.attachResumedSession("view-1", boundary.session);

    const second = await runtime.attachResumedSession("view-1", boundary.session);

    expect(second).toBe(first);
    expect(boundary.subscriptionCount()).toBe(1);
    expect(boundary.handlerInstallations).toEqual({ approval: 1, question: 1 });
    expect(boundary.closeCount()).toBe(0);
  });

  it("removes every Webview mapping when a shared session is closed", async () => {
    const { runtime } = createRuntime();
    const opened = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: opened.id }));

    await runtime.closeSession(opened.id);

    expect(runtime.getSessionForView("view-1")).toBeUndefined();
    expect(runtime.getSessionForView("view-2")).toBeUndefined();
  });

  it("delegates deletion after the active session has been closed", async () => {
    const { runtime, sdk } = createRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    await runtime.deleteSession(opened.id);

    expect(boundary.closeCount()).toBe(1);
    expect(sdk.deleteSessionIds).toEqual([opened.id]);
  });

  it("closes every active SDK session when the host runtime is disposed", async () => {
    const { runtime, sdk } = createRuntime();
    const first = await runtime.openSession(openOptions({ webviewId: "view-1" }));
    const secondBoundary = sdk.addSession("saved-2", "/workspace");
    await runtime.openSession(openOptions({ webviewId: "view-2", sessionId: "saved-2" }));

    await runtime.dispose();

    expect(sdk.sessions.get(first.id)?.closeCount()).toBe(1);
    expect(secondBoundary.closeCount()).toBe(1);
    expect(sdk.closeCount()).toBe(1);
  });

  it("does not retain a resumed session when it belongs to a different working directory", async () => {
    const { runtime, sdk } = createRuntime();
    const foreign = sdk.addSession("foreign-1", "/other-workspace");

    await expect(
      runtime.openSession(openOptions({ sessionId: "foreign-1" })),
    ).rejects.toThrow("The selected session belongs to a different working directory.");

    expect(runtime.getSession("foreign-1")).toBeUndefined();
    expect(foreign.closeCount()).toBe(1);
  });

  function createRecordingRuntime() {
    const sdk = createFakeHarness();
    const broadcasts: Array<{ event: string; data: unknown }> = [];
    const runtime = new PythinkerRuntime({
      version: "test",
      harness: sdk.harness,
      broadcast: (event: string, data: unknown) => {
        broadcasts.push({ event, data });
      },
      captureBaseline: () => undefined,
      log: () => undefined,
    });
    return { runtime, sdk, broadcasts };
  }

  it("fails a reentrant prompt without disturbing the running turn", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    let releaseTurn!: () => void;
    boundary.setPromptImpl(() => new Promise<void>((resolve) => {
      releaseTurn = resolve;
    }));
    const first = opened.prompt("first message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t1" } as unknown as Event);
    expect(opened.isBusy).toBe(true);

    await expect(opened.prompt("concurrent message")).resolves.toEqual({ status: "failed" });

    // The rejection surfaces as a mid-turn warning; the active turn is untouched.
    expect(opened.isBusy).toBe(true);
    const busyWarning = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(busyWarning?.data).toMatchObject({
      type: "error",
      phase: "runtime",
      detail: "A response is already being generated for this session.",
      terminal: false,
    });

    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t1", reason: "completed" } as unknown as Event);
    releaseTurn();
    await expect(first).resolves.toEqual({ status: "finished" });
    expect(opened.isBusy).toBe(false);
  });

  it("rejects a prompt during an exclusive operation with a terminal error", async () => {
    const { runtime, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());

    let releaseExclusive!: () => void;
    const exclusive = opened.runExclusiveAfterCancelling(
      () => new Promise<void>((resolve) => {
        releaseExclusive = resolve;
      }),
    );
    // No active work means no later stream_complete: the rejection must be
    // terminal so the caller's composer can unlock.
    expect(opened.isBusy).toBe(true);

    await expect(opened.prompt("during fork")).resolves.toEqual({ status: "failed" });
    const rejection = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(rejection?.data).toMatchObject({ type: "error", phase: "runtime" });
    expect((rejection?.data as Record<string, unknown>)["terminal"]).toBeUndefined();

    releaseExclusive();
    await exclusive;
    expect(opened.isBusy).toBe(false);
  });

  it("marks a mid-turn core error as non-terminal until the turn ends", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    let releaseTurn!: () => void;
    boundary.setPromptImpl(() => new Promise<void>((resolve) => {
      releaseTurn = resolve;
    }));
    const first = opened.prompt("first message");
    boundary.emit({ type: "turn.started", agentId: "main", sessionId: opened.id, turnId: "t1" } as unknown as Event);

    boundary.emit({
      type: "error",
      agentId: "main",
      sessionId: opened.id,
      code: "records.write_failed",
      message: "Failed to write agent records: EACCES",
    } as unknown as Event);

    // The turn is still running: no settlement, no terminal error on the wire.
    expect(opened.isBusy).toBe(true);
    const warning = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(warning?.data).toMatchObject({
      type: "error",
      code: "records.write_failed",
      phase: "runtime",
      terminal: false,
    });

    boundary.emit({ type: "turn.ended", agentId: "main", sessionId: opened.id, turnId: "t1", reason: "completed" } as unknown as Event);
    releaseTurn();
    await expect(first).resolves.toEqual({ status: "finished" });
    expect(opened.isBusy).toBe(false);
  });

  it("keeps preflight failures terminal", async () => {
    const { runtime, sdk, broadcasts } = createRecordingRuntime();
    const opened = await runtime.openSession(openOptions());
    const boundary = sdk.sessions.get(opened.id)!;

    boundary.setPromptImpl(() => Promise.reject(new Error("provider down")));

    await expect(opened.prompt("hi")).resolves.toEqual({ status: "failed" });
    const failure = broadcasts.find(({ data }) => (data as { type?: string }).type === "error");
    expect(failure?.data).toMatchObject({ type: "error", phase: "preflight" });
    expect((failure?.data as Record<string, unknown>)["terminal"]).toBeUndefined();
    expect(opened.isBusy).toBe(false);
  });
});
