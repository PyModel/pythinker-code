import { bridge } from "@/services";
import { useApprovalStore } from "./approval.store";
import { useSettingsStore } from "./settings.store";
import { isPreflightError, isUserInterrupt } from "shared/errors";
import type { ChatMessage, UIStep, UIStepItem, UISubagentStatus, ChatState, TokenUsage } from "./chat.store";
import type { ContentPart, ToolCall, ToolResult, TurnBegin, SubagentEvent, SubagentStatusPayload, ApprovalRequestPayload, DiffBlock, RunResult, QuestionRequest } from "shared/legacy-sdk";
import type { UIStreamEvent, StreamError } from "shared/types";

type EventHandler = (draft: ChatState, payload: any) => void;

function createEmptyTokenUsage(): TokenUsage {
  return { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 };
}

function addTokenUsage(target: TokenUsage, source: TokenUsage): void {
  target.input_other += source.input_other || 0;
  target.output += source.output || 0;
  target.input_cache_read += source.input_cache_read || 0;
  target.input_cache_creation += source.input_cache_creation || 0;
}

function extractDiffPaths(display?: { type: string; path?: string }[]): string[] {
  if (!display) {
    return [];
  }
  return display.filter((block): block is DiffBlock => block.type === "diff" && typeof block.path === "string").map((block) => block.path);
}

function getLastAssistant(draft: ChatState): ChatMessage | undefined {
  const last = draft.messages.at(-1);
  return last?.role === "assistant" ? last : undefined;
}

function hasContent(message: ChatMessage): boolean {
  if (typeof message.content === "string" && message.content.trim()) {
    return true;
  }
  if (Array.isArray(message.content) && message.content.length > 0) {
    return true;
  }

  return message.steps?.some((s) => s.items.length > 0) ?? false;
}

function findToolUseItem(steps: UIStep[], toolId: string): (UIStepItem & { type: "tool_use" }) | null {
  for (const step of steps) {
    for (const item of step.items) {
      if (item.type === "tool_use") {
        if (item.id === toolId) {
          return item;
        }

        if (item.subagent_steps) {
          const found = findToolUseItem(item.subagent_steps, toolId);
          if (found) {
            return found;
          }
        }
      }
    }
  }

  return null;
}

interface SubagentTarget {
  steps: UIStep[];
  event: { type: string; payload: any };
  toolItem: UIStepItem & { type: "tool_use" };
  agentId: string;
  agentLabel?: string;
  agentIndex?: number;
}

function resolveSubagentTarget(steps: UIStep[], payload: SubagentEvent): SubagentTarget | null {
  const { parent_tool_call_id, event, agent_id, agent_label, agent_index } = payload;

  // Nested SubagentEvent
  if (event.type === "SubagentEvent") {
    return resolveSubagentTarget(steps, event.payload as SubagentEvent);
  }

  const toolItem = findToolUseItem(steps, parent_tool_call_id);
  if (!toolItem) {
    return null;
  }

  if (!toolItem.subagent_steps) {
    toolItem.subagent_steps = [];
  }

  return {
    steps: toolItem.subagent_steps,
    event,
    toolItem,
    agentId: agent_id,
    agentLabel: agent_label,
    agentIndex: agent_index,
  };
}

function applySubagentStatus(
  toolItem: UIStepItem & { type: "tool_use" },
  payload: SubagentStatusPayload,
): void {
  if (!toolItem.subagent_status) {
    toolItem.subagent_status = {};
  }
  const existing = toolItem.subagent_status[payload.agent_id];

  const status: UISubagentStatus = {
    status: payload.status,
    label: payload.agent_label ?? existing?.label,
    index: payload.agent_index ?? existing?.index,
    // First transition to "running" stamps the start; the engine sends no timestamps
    // of its own, so wall-clock lane duration is only as precise as Date.now() here.
    startedAt: payload.status === "running" ? (existing?.startedAt ?? Date.now()) : existing?.startedAt,
    endedAt:
      payload.status === "done" || payload.status === "failed" || payload.status === "suspended"
        ? (existing?.endedAt ?? Date.now())
        : existing?.endedAt,
    error: payload.error ?? existing?.error,
    resultSummary: payload.result_summary ?? existing?.resultSummary,
  };
  toolItem.subagent_status[payload.agent_id] = status;
}

function finishAllTextItems(steps: UIStep[]): void {
  for (const step of steps) {
    for (const item of step.items) {
      if (item.type === "text" || item.type === "thinking") {
        item.finished = true;
      }
      if (item.type === "tool_use" && item.subagent_steps) {
        finishAllTextItems(item.subagent_steps);
      }
    }
  }
}

interface StepAgent {
  id: string;
  label?: string;
  index?: number;
}

function findLastStepForAgent(steps: UIStep[], agentId: string): UIStep | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.agentId === agentId) return step;
  }
  return undefined;
}

function applyEventToSteps(
  steps: UIStep[],
  event: { type: string; payload: any },
  onText?: (text: string) => void,
  agent?: StepAgent,
): void {
  // When an agent is known, target its own latest step rather than the array's
  // tail — two agents can otherwise land text/tool calls in each other's step.
  const currentStep = agent ? findLastStepForAgent(steps, agent.id) : steps.at(-1);

  const appendOrCreate = (type: "text" | "thinking", content: string): void => {
    if (!currentStep) {
      return;
    }
    const last = currentStep.items.at(-1);

    if (last?.type === type) {
      (last as { content: string }).content += content;
    } else {
      currentStep.items.push({ type, content });
    }
  };

  const findLastToolUse = (): (UIStepItem & { type: "tool_use" }) | null => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (agent && steps[i].agentId !== agent.id) {
        continue;
      }
      const items = steps[i].items;

      for (let j = items.length - 1; j >= 0; j--) {
        if (items[j].type === "tool_use") {
          return items[j] as UIStepItem & { type: "tool_use" };
        }
      }
    }

    return null;
  };

  // Sets the result and returns the tool item, so the ToolResult handler below
  // can reuse it (e.g. for the batch-abort freeze) without a second tree walk.
  const setToolResult = (
    subSteps: UIStep[],
    toolCallId: string,
    returnValue: ToolResult["return_value"],
  ): (UIStepItem & { type: "tool_use" }) | null => {
    for (const step of subSteps) {
      for (const item of step.items) {
        if (item.type === "tool_use") {
          if (item.id === toolCallId) {
            item.result = returnValue;
            return item;
          }

          if (item.subagent_steps) {
            const found = setToolResult(item.subagent_steps, toolCallId, returnValue);
            if (found) return found;
          }
        }
      }
    }

    return null;
  };

  switch (event.type) {
    case "StepBegin":
      finishAllTextItems(steps);
      steps.push({
        n: event.payload.n,
        items: [],
        agentId: agent?.id,
        agentLabel: agent?.label,
        agentIndex: agent?.index,
      });
      break;

    case "ContentPart": {
      const part = event.payload as ContentPart;

      if (part.type === "text" && part.text) {
        appendOrCreate("text", part.text);
        onText?.(part.text);
      } else if (part.type === "think" && part.think) {
        appendOrCreate("thinking", part.think);
      }

      break;
    }

    case "ToolCall": {
      if (!currentStep) {
        break;
      }
      finishAllTextItems(steps);
      const call = event.payload as ToolCall;

      currentStep.items.push({
        type: "tool_use",
        id: call.id,
        call: {
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? null,
        },
      });

      break;
    }

    case "ToolCallPart": {
      const { arguments_part, tool_call_id } = event.payload;
      if (!arguments_part) {
        break;
      }
      const tool = typeof tool_call_id === "string"
        ? findToolUseItem(steps, tool_call_id)
        : findLastToolUse();

      if (tool) {
        tool.call.arguments = (tool.call.arguments || "") + arguments_part;
      }

      break;
    }

    case "ToolResult": {
      const result = event.payload as ToolResult;
      const toolItem = setToolResult(steps, result.tool_call_id, result.return_value);

      // Batch aborted: lanes still spawned/running when the parent result lands
      // have no further lifecycle events coming, so freeze them as failed.
      if (toolItem?.subagent_status) {
        for (const status of Object.values(toolItem.subagent_status)) {
          if (status.status === "spawned" || status.status === "running") {
            status.status = "failed";
            status.endedAt = status.endedAt ?? Date.now();
          }
        }
      }

      const paths = extractDiffPaths(result.return_value.display);
      if (paths.length > 0) {
        void bridge.trackFiles(paths);
      }

      break;
    }
  }
}

function isTaskToolResult(steps: UIStep[] | undefined, toolCallId: string): boolean {
  if (!steps) {
    return false;
  }
  const toolItem = findToolUseItem(steps, toolCallId);
  return toolItem?.call.name === "Task" || toolItem?.call.name === "Agent";
}

function handlePreflightError(draft: ChatState, _code: string, _message: string): void {
  // Pre-flight: Remove unsent messages and restore input
  addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
  draft.activeTokenUsage = createEmptyTokenUsage();
  draft.isStreaming = false;
  draft.isCompacting = false;
  useApprovalStore.getState().clearRequests();

  // Remove empty assistant message
  const lastAssistant = getLastAssistant(draft);
  if (lastAssistant && !hasContent(lastAssistant)) {
    draft.messages.pop();
  }

  // Remove corresponding user message
  const lastUser = draft.messages.at(-1);
  if (lastUser?.role === "user") {
    const userContent = lastUser.content;
    draft.messages.pop();
    // Trigger rollback (saved via pendingInput)
    draft.pendingInput = { content: userContent, model: "" };
  }
}

function handleRuntimeError(draft: ChatState, code: string, message: string, detail?: string): void {
  // Runtime: Preserve context and add inline error
  addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
  draft.activeTokenUsage = createEmptyTokenUsage();
  draft.isStreaming = false;
  draft.isCompacting = false;
  useApprovalStore.getState().clearRequests();

  const lastAssistant = getLastAssistant(draft);
  if (lastAssistant) {
    // If there is no content at all, add an empty step to display the error
    if (!lastAssistant.steps) {
      lastAssistant.steps = [];
    }
    finishAllTextItems(lastAssistant.steps);
    // Set inline error, preserving original server error detail
    lastAssistant.inlineError = { code, message, detail };
  }
}

const eventHandlers: Record<string, EventHandler> = {
  // UI events (Bridge layer)
  session_start: (draft, payload: { sessionId: string; model?: string }) => {
    if (payload.sessionId) {
      draft.sessionId = payload.sessionId;
    }
  },

  stream_complete: (draft, _payload: { result: RunResult }) => {
    addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
    draft.activeTokenUsage = createEmptyTokenUsage();
    draft.isStreaming = false;
    draft.isCompacting = false;
    draft.pendingInput = null;
    useApprovalStore.getState().clearRequests();
    const lastAssistant = getLastAssistant(draft);
    if (lastAssistant?.steps) {
      finishAllTextItems(lastAssistant.steps);
    }
  },

  error: (draft, payload: StreamError) => {
    const code = payload.code || "UNKNOWN";
    const phase = payload.phase || (isPreflightError(code) ? "preflight" : "runtime");

    if (code === "UNKNOWN_EVENT_TYPE") {
      return;
    } // Ignore unknown event type errors, usually caused by version mismatch

    if (phase === "preflight") {
      handlePreflightError(draft, code, payload.message);
    } else {
      if (isUserInterrupt(code)) {
        addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
        draft.activeTokenUsage = createEmptyTokenUsage();
        draft.isStreaming = false;
        draft.isCompacting = false;
        useApprovalStore.getState().clearRequests();
        const lastAssistant = getLastAssistant(draft);
        if (lastAssistant?.steps) {
          finishAllTextItems(lastAssistant.steps);
        }
      } else {
        handleRuntimeError(draft, code, payload.message, payload.detail);
      }
    }
  },

  // Wire events
  TurnBegin: (draft, payload: TurnBegin & { forkable?: boolean }) => {
    draft.tokenUsage = createEmptyTokenUsage();
    draft.activeTokenUsage = createEmptyTokenUsage();

    draft.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: payload.user_input,
      timestamp: Date.now(),
      forkable: payload.forkable,
    }, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      steps: [],
      forkable: payload.forkable,
    });

    draft.isStreaming = true;
  },

  CompactionBegin: (draft) => {
    draft.isCompacting = true;

    const last = getLastAssistant(draft);

    if (last) {
      if (!last.steps) {
        last.steps = [];
      }

      if (last.steps.length === 0) {
        last.steps.push({ n: 0, items: [] });
      }

      finishAllTextItems(last.steps);
      last.steps.at(-1)!.items.push({ type: "compaction" });
    }
  },

  CompactionEnd: (draft) => {
    draft.isCompacting = false;
  },

  StepBegin: (draft, payload) => {
    if (draft.lastStatus?.retrying) {
      draft.lastStatus.retrying = null;
    }
    const last = getLastAssistant(draft);

    if (last) {
      if (!last.steps) {
        last.steps = [];
      }

      applyEventToSteps(last.steps, { type: "StepBegin", payload });

      // Tag the newly created step with current plan mode state
      // Note: only top-level steps get tagged. Subagent steps go through
      // SubagentEvent -> applyEventToSteps and won't inherit main agent's planMode.
      const newStep = last.steps.at(-1);
      if (newStep && draft.planMode) {
        newStep.planMode = true;
      }
    }
  },

  StepInterrupted: (draft) => {
    addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
    draft.activeTokenUsage = createEmptyTokenUsage();

    draft.isStreaming = false;
    useApprovalStore.getState().clearRequests();
    const lastAssistant = getLastAssistant(draft);
    if (lastAssistant?.steps) {
      finishAllTextItems(lastAssistant.steps);
    }
  },

  ContentPart: (draft, payload: ContentPart) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    applyEventToSteps(last.steps, { type: "ContentPart", payload }, (text) => {
      if (typeof last.content === "string") {
        last.content += text;
      }
    });
  },

  ToolCall: (draft, payload: ToolCall) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }
    applyEventToSteps(last.steps, { type: "ToolCall", payload });
  },

  ToolCallPart: (draft, payload) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }
    applyEventToSteps(last.steps, { type: "ToolCallPart", payload });
  },

  ToolResult: (draft, payload: ToolResult) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    if (isTaskToolResult(last.steps, payload.tool_call_id)) {
      addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
      draft.activeTokenUsage = createEmptyTokenUsage();
    }

    applyEventToSteps(last.steps, { type: "ToolResult", payload });
  },

  SubagentEvent: (draft, payload: SubagentEvent) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    const target = resolveSubagentTarget(last.steps, payload);
    if (!target) {
      return;
    }

    if (target.event.type === "StatusUpdate") {
      const { token_usage } = target.event.payload;

      if (token_usage) {
        addTokenUsage(draft.activeTokenUsage, {
          input_other: token_usage.input_other || 0,
          output: token_usage.output || 0,
          input_cache_read: token_usage.input_cache_read || 0,
          input_cache_creation: token_usage.input_cache_creation || 0,
        });
      }

      return;
    }

    if (target.event.type === "SubagentStatus") {
      applySubagentStatus(target.toolItem, target.event.payload as SubagentStatusPayload);
      return;
    }

    // Seeds a step only for an agent whose first event arrives before its own
    // StepBegin. Seeding on StepBegin too would leave every lane with a leading
    // empty step and inflate its step count by one.
    if (target.event.type !== "StepBegin" && !target.steps.some((s) => s.agentId === target.agentId)) {
      target.steps.push({
        n: 1,
        items: [],
        agentId: target.agentId,
        agentLabel: target.agentLabel,
        agentIndex: target.agentIndex,
      });
    }

    // Nested Subagent Task End: accumulate token usage
    if (target.event.type === "ToolResult") {
      const toolResultPayload = target.event.payload as ToolResult;
      if (isTaskToolResult(target.steps, toolResultPayload.tool_call_id)) {
        addTokenUsage(draft.tokenUsage, draft.activeTokenUsage);
        draft.activeTokenUsage = createEmptyTokenUsage();
      }
    }

    applyEventToSteps(
      target.steps,
      target.event,
      undefined,
      { id: target.agentId, label: target.agentLabel, index: target.agentIndex },
    );
  },

  SubagentStatus: (draft, payload: SubagentStatusPayload) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) {
      return;
    }

    const toolItem = findToolUseItem(last.steps, payload.parent_tool_call_id);
    if (!toolItem) {
      return;
    }

    applySubagentStatus(toolItem, payload);
  },

  ApprovalRequest: (_, payload: ApprovalRequestPayload) => {
    useApprovalStore.getState().addRequest({
      id: payload.id,
      tool_call_id: payload.tool_call_id,
      sender: payload.sender,
      action: payload.action,
      description: payload.description,
      display: payload.display ?? [],
    });
  },

  QuestionRequest: (draft, payload: QuestionRequest) => {
    draft.pendingQuestion = payload;
  },

  StatusUpdate: (draft, payload) => {
    const { context_usage, token_usage, plan_mode, model, thinking_effort, retrying } = payload;

    if (typeof model === "string" && model.length > 0) {
      useSettingsStore.getState().setCurrentModel(model);
    }
    if (typeof thinking_effort === "string" && thinking_effort.length > 0) {
      useSettingsStore.getState().setThinkingEffort(thinking_effort);
    }

    if (plan_mode !== undefined && plan_mode !== null) {
      draft.planMode = plan_mode;
    }

    if (token_usage) {
      addTokenUsage(draft.activeTokenUsage, {
        input_other: token_usage.input_other || 0,
        output: token_usage.output || 0,
        input_cache_read: token_usage.input_cache_read || 0,
        input_cache_creation: token_usage.input_cache_creation || 0,
      });
    }

    draft.lastStatus = {
      context_usage: context_usage ?? draft.lastStatus?.context_usage,
      token_usage,
      retrying: retrying ?? draft.lastStatus?.retrying,
    };

    const last = getLastAssistant(draft);

    if (last) {
      last.status = draft.lastStatus;
    }
  },

  SteerInput: (draft, payload: { user_input: string | ContentPart[] }) => {
    const last = getLastAssistant(draft);
    if (!last?.steps) return;

    const currentStep = last.steps.at(-1);
    if (!currentStep) return;

    finishAllTextItems(last.steps);
    currentStep.items.push({ type: "steer", content: payload.user_input });
  },
};

export function processEvent(draft: ChatState, event: UIStreamEvent): void {
  const handler = eventHandlers[event.type];

  if (handler) {
    const payload = "payload" in event ? event.payload : event;
    handler(draft, payload);
  }
}
