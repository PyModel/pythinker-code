/**
 * Scenario: `DynamicWorkflow` batches stream events for many subagents that share one
 * parent tool call. Store-level event handling must attribute each agent's steps to that
 * agent alone, and per-agent status/lane derivation must reflect the wire protocol.
 * Wiring: the real Zustand chat store; the VS Code bridge is the only replaced boundary.
 * Run: pnpm exec vitest run --config apps/vscode/vitest.config.ts test/event-handlers.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  streamChat: vi.fn(),
  abortChat: vi.fn(),
  trackFiles: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/services", () => ({
  bridge: {
    saveConfig: boundary.saveConfig,
    streamChat: boundary.streamChat,
    abortChat: boundary.abortChat,
    trackFiles: boundary.trackFiles,
  },
}));
vi.mock("@/components/ui/sonner", () => ({
  toast: { error: boundary.toastError, warning: boundary.toastWarning },
}));

import { useChatStore } from "../webview-ui/src/stores/chat.store";
import { deriveWorkflowLanes, maxLaneStepCount } from "../webview-ui/src/lib/workflow-lanes";
import type { UIStepItem } from "../webview-ui/src/stores/chat.store";

beforeEach(() => {
  boundary.streamChat.mockReset();
  boundary.abortChat.mockReset();
  boundary.trackFiles.mockReset();
  useChatStore.setState({
    sessionId: null,
    messages: [],
    isStreaming: false,
    isCompacting: false,
    handshakeReceived: false,
    draftMedia: [],
    lastStatus: null,
    tokenUsage: { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 },
    activeTokenUsage: { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 },
    pendingInput: null,
    queue: [],
    pendingQuestion: null,
    planMode: false,
  });
});

function startWorkflowTurn() {
  useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "run workflow" } });
  useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 1 } });
  useChatStore.getState().processEvent({
    type: "ToolCall",
    payload: { type: "function", id: "wf-1", function: { name: "DynamicWorkflow", arguments: "{}" } },
  });
}

function workflowToolItem(): UIStepItem & { type: "tool_use" } {
  const last = useChatStore.getState().messages.at(-1)!;
  const item = last.steps!.at(0)!.items.find((i) => i.type === "tool_use");
  return item as UIStepItem & { type: "tool_use" };
}

function wrap(agentId: string, event: { type: string; payload: unknown }, agentIndex?: number) {
  return {
    type: "SubagentEvent",
    payload: {
      parent_tool_call_id: "wf-1",
      agent_id: agentId,
      agent_label: "explore",
      agent_index: agentIndex,
      event,
    },
  };
}

describe("Webview DynamicWorkflow per-agent lanes", () => {
  it("keeps each subagent's streamed text in its own step when two agents interleave", () => {
    startWorkflowTurn();

    // Agent A opens its step, agent B opens its step, then their text arrives
    // out of order. Each agent's text must land only in its own step.
    useChatStore.getState().processEvent(wrap("agentA", { type: "StepBegin", payload: { n: 1 } }, 1));
    useChatStore.getState().processEvent(wrap("agentB", { type: "StepBegin", payload: { n: 1 } }, 2));
    useChatStore.getState().processEvent(wrap("agentA", { type: "ContentPart", payload: { type: "text", text: "hello from A" } }, 1));
    useChatStore.getState().processEvent(wrap("agentB", { type: "ContentPart", payload: { type: "text", text: "hello from B" } }, 2));
    useChatStore.getState().processEvent(wrap("agentA", { type: "ContentPart", payload: { type: "text", text: ", continued" } }, 1));

    const toolItem = workflowToolItem();
    const textFor = (agentId: string) =>
      toolItem
        .subagent_steps!.filter((s) => s.agentId === agentId)
        .flatMap((s) => s.items)
        .filter((i): i is { type: "text"; content: string } => i.type === "text")
        .map((i) => i.content)
        .join("");

    expect(textFor("agentA")).toBe("hello from A, continued");
    expect(textFor("agentB")).toBe("hello from B");
  });

  it("gives an agent exactly one step per StepBegin, with no leading empty step", () => {
    startWorkflowTurn();

    // A lane's step count drives its progress bar, so a seeded placeholder step
    // in front of the agent's own StepBegin would inflate every lane by one.
    useChatStore.getState().processEvent(wrap("agentA", { type: "StepBegin", payload: { n: 1 } }, 1));
    useChatStore.getState().processEvent(wrap("agentA", { type: "ContentPart", payload: { type: "text", text: "work" } }, 1));
    useChatStore.getState().processEvent(wrap("agentB", { type: "StepBegin", payload: { n: 1 } }, 2));
    useChatStore.getState().processEvent(wrap("agentB", { type: "ContentPart", payload: { type: "text", text: "work" } }, 2));

    const steps = workflowToolItem().subagent_steps!;
    expect(steps.filter((s) => s.agentId === "agentA")).toHaveLength(1);
    expect(steps.filter((s) => s.agentId === "agentB")).toHaveLength(1);
    expect(steps.every((s) => s.items.length > 0)).toBe(true);
  });

  it("stamps startedAt/endedAt as a lane's SubagentStatus transitions", () => {
    startWorkflowTurn();

    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentA", agent_label: "explore", agent_index: 1, status: "spawned" },
    });
    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentA", status: "running" },
    });
    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentA", status: "done", result_summary: "Explored 3 files" },
    });

    const status = workflowToolItem().subagent_status!["agentA"]!;
    expect(status.status).toBe("done");
    expect(status.resultSummary).toBe("Explored 3 files");
    expect(typeof status.startedAt).toBe("number");
    expect(typeof status.endedAt).toBe("number");
  });

  it("targets the main agent's steps by array tail when no agent is scoped", () => {
    // The only remaining no-agent case: applyEventToSteps called directly for
    // the main agent's own turn, not through a SubagentEvent wrapper.
    useChatStore.getState().processEvent({ type: "TurnBegin", payload: { user_input: "hello" } });
    useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 1 } });
    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "first" } });
    useChatStore.getState().processEvent({ type: "StepBegin", payload: { n: 2 } });
    useChatStore.getState().processEvent({ type: "ContentPart", payload: { type: "text", text: "second" } });

    const last = useChatStore.getState().messages.at(-1)!;
    expect(last.steps!.every((s) => s.agentId === undefined)).toBe(true);
    const texts = last.steps!
      .flatMap((s) => s.items)
      .filter((i): i is { type: "text"; content: string } => i.type === "text")
      .map((i) => i.content);
    expect(texts).toEqual(["first", "second"]);
  });

  it("does not drop a second agent's content that arrives before that agent's own StepBegin", () => {
    startWorkflowTurn();

    // Agent A is already streaming; agent B's very first event is content,
    // arriving before B has emitted its own StepBegin.
    useChatStore.getState().processEvent(wrap("agentA", { type: "StepBegin", payload: { n: 1 } }, 1));
    useChatStore.getState().processEvent(wrap("agentA", { type: "ContentPart", payload: { type: "text", text: "from A" } }, 1));
    useChatStore.getState().processEvent(wrap("agentB", { type: "ContentPart", payload: { type: "text", text: "from B" } }, 2));

    const toolItem = workflowToolItem();
    const textFor = (agentId: string) =>
      toolItem
        .subagent_steps!.filter((s) => s.agentId === agentId)
        .flatMap((s) => s.items)
        .filter((i): i is { type: "text"; content: string } => i.type === "text")
        .map((i) => i.content)
        .join("");

    expect(textFor("agentB")).toBe("from B");
    expect(textFor("agentA")).toBe("from A");
  });

  it("marks lanes still spawned/running as failed when the batch's parent ToolResult lands", () => {
    startWorkflowTurn();

    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentA", agent_label: "explore", agent_index: 1, status: "spawned" },
    });
    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentA", status: "running" },
    });
    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentB", agent_label: "explore", agent_index: 2, status: "spawned" },
    });
    useChatStore.getState().processEvent({
      type: "SubagentStatus",
      payload: { parent_tool_call_id: "wf-1", agent_id: "agentC", agent_label: "explore", agent_index: 3, status: "done" },
    });

    // The batch is aborted: the parent tool call resolves while agentA (running)
    // and agentB (spawned) never received a terminal lifecycle event of their own.
    useChatStore.getState().processEvent({
      type: "ToolResult",
      payload: { tool_call_id: "wf-1", return_value: { is_error: true, output: "aborted", message: "", display: [] } },
    });

    const status = workflowToolItem().subagent_status!;
    expect(status["agentA"]!.status).toBe("failed");
    expect(typeof status["agentA"]!.endedAt).toBe("number");
    expect(status["agentB"]!.status).toBe("failed");
    expect(typeof status["agentB"]!.endedAt).toBe("number");
    // Already-terminal lanes are left alone.
    expect(status["agentC"]!.status).toBe("done");
  });
});

describe("workflow lane derivation", () => {
  it("groups steps by agent, orders lanes by agentIndex, and sizes the bar to the busiest lane", () => {
    const steps = [
      { n: 1, items: [], agentId: "b", agentLabel: "explore", agentIndex: 2 },
      { n: 1, items: [], agentId: "a", agentLabel: "explore", agentIndex: 1 },
      { n: 2, items: [], agentId: "a", agentLabel: "explore", agentIndex: 1 },
    ];
    const statuses = {
      a: { status: "done" as const },
      b: { status: "running" as const },
      c: { status: "spawned" as const, label: "explore", index: 3 },
    };

    const lanes = deriveWorkflowLanes(steps, statuses);

    expect(lanes.map((l) => l.agentId)).toEqual(["a", "b", "c"]);
    expect(lanes.map((l) => l.stepCount)).toEqual([2, 1, 0]);
    expect(maxLaneStepCount(lanes)).toBe(2);
  });
});
