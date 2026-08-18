import { z } from 'zod';

import type { DynamicWorkflowMode } from '../../../agent/dynamic_workflow';
import type { BuiltinTool } from '../../../agent/tool';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../../session/subagent-host';
import { stripSubagentModelParameter } from '../../../session/subagent-binding';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import AGENT_DYNAMIC_WORKFLOW_DESCRIPTION from './agent-dynamic_workflow.md?raw';

const DEFAULT_SUBAGENT_TYPE = 'coder';
const PROMPT_TEMPLATE_PLACEHOLDER = '{{item}}';
const MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS = 128;

export const AgentDynamicWorkflowToolInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .describe('Short description for the whole dynamic_workflow.'),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Subagent type used for every new subagent spawned from items; defaults to coder when omitted. Resumed subagents always keep their original type, so passing subagent_type together with resume_agent_ids is allowed — it only affects the item-based spawns.',
      ),
    model: z
      .enum(['primary', 'secondary'])
      .optional()
      .describe(
        'Model for every new subagent spawned from items: "secondary" uses the configured secondary model (the default when one is set), "primary" uses the model you are running on. Resumed subagents keep their bound model.',
      ),
    prompt_template: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        `Prompt template for each subagent. The ${PROMPT_TEMPLATE_PLACEHOLDER} placeholder is replaced with each item value.`,
      ),
    items: z
      .array(z.string().trim().min(1))
      .max(MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS)
      .optional()
      .describe(
        `Values used to fill ${PROMPT_TEMPLATE_PLACEHOLDER}. Each item launches one new subagent.`,
      ),
    resume_agent_ids: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional()
      .describe(
        'Map of existing subagent agent_id to the prompt used to resume that subagent. These resumed subagents are launched before new item-based subagents.',
      ),
  })
  .strict();

export type AgentDynamicWorkflowToolInput = z.infer<typeof AgentDynamicWorkflowToolInputSchema>;

interface AgentDynamicWorkflowSpawnSpec {
  readonly kind: 'spawn';
  readonly index: number;
  readonly item: string;
  readonly prompt: string;
}

interface AgentDynamicWorkflowResumeSpec {
  readonly kind: 'resume';
  readonly index: number;
  readonly agentId: string;
  readonly item?: string;
  readonly prompt: string;
}

type AgentDynamicWorkflowSpec = AgentDynamicWorkflowSpawnSpec | AgentDynamicWorkflowResumeSpec;

interface DynamicWorkflowRunResult {
  readonly spec: AgentDynamicWorkflowSpec;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly error?: string;
}

const AGENT_DYNAMIC_WORKFLOW_PARAMETERS = toInputJsonSchema(AgentDynamicWorkflowToolInputSchema);
const AGENT_DYNAMIC_WORKFLOW_PARAMETERS_NO_MODEL = stripSubagentModelParameter(AGENT_DYNAMIC_WORKFLOW_PARAMETERS);

export class AgentDynamicWorkflowTool implements BuiltinTool<AgentDynamicWorkflowToolInput> {
  readonly name = 'AgentDynamicWorkflow' as const;
  readonly description: string;
  readonly parameters: Record<string, unknown>;

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly dynamicWorkflowMode: DynamicWorkflowMode,
    // `0` = no timeout, preserved on purpose (`0 ?? DEFAULT` stays `0`);
    // SubagentBatch arms no timer for non-positive timeouts.
    private readonly subagentTimeoutMs?: number,
    subagentModelDescription?: string,
    // Mirrors the `secondary-model` experiment: off (the default), the no-op
    // `model` parameter is stripped from the advertised schema so the
    // secondary-model concept never enters the prompt.
    modelChoiceEnabled = false,
  ) {
    this.description =
      subagentModelDescription === undefined
        ? AGENT_DYNAMIC_WORKFLOW_DESCRIPTION
        : `${AGENT_DYNAMIC_WORKFLOW_DESCRIPTION}\n\n${subagentModelDescription}`;
    this.parameters = modelChoiceEnabled
      ? AGENT_DYNAMIC_WORKFLOW_PARAMETERS
      : AGENT_DYNAMIC_WORKFLOW_PARAMETERS_NO_MODEL;
  }

  resolveExecution(args: AgentDynamicWorkflowToolInput): ToolExecution {
    const agentCount = (args.items?.length ?? 0) + Object.keys(args.resume_agent_ids ?? {}).length;
    return {
      accesses: ToolAccesses.all(),
      description: `Launching agent dynamic_workflow: ${args.description}`,
      display: {
        kind: 'agent_call',
        agent_name: `dynamic_workflow (${agentCount} subagents)`,
        prompt: args.description,
      },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: AgentDynamicWorkflowToolInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      this.dynamicWorkflowMode.enter('tool');
      const result = await this.runDynamicWorkflow(args, context.signal, context.toolCallId);
      return {
        output: result,
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private async runDynamicWorkflow(
    args: AgentDynamicWorkflowToolInput,
    signal: AbortSignal,
    toolCallId: string,
  ): Promise<string> {
    const profileName = normalizeOptionalString(args.subagent_type) ?? DEFAULT_SUBAGENT_TYPE;
    const specs = createAgentDynamicWorkflowSpecs(args, (agentId) => this.subagentHost.getDynamicWorkflowItem(agentId));
    const tasks = specs.map((spec): QueuedSubagentTask<AgentDynamicWorkflowSpec> => {
      const descriptionName = spec.kind === 'resume' ? 'resume' : profileName;
      const common = {
        data: spec,
        profileName: spec.kind === 'resume' ? 'subagent' : profileName,
        parentToolCallId: toolCallId,
        prompt: spec.prompt,
        description: childDescription(args.description, spec.index, descriptionName),
        dynamicWorkflowIndex: spec.index,
        runInBackground: false,
        dynamic_workflowItem: spec.item,
        signal,
        timeout: this.subagentTimeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
        modelChoice: args.model,
      };
      if (spec.kind === 'resume') {
        return {
          ...common,
          kind: 'resume',
          resumeAgentId: spec.agentId,
        };
      }
      return {
        ...common,
        kind: 'spawn',
      };
    });
    const results = await this.subagentHost.runQueued(tasks);
    return renderDynamicWorkflowResults(results.map(({ task, ...result }) => ({ spec: task.data, ...result })));
  }
}

function createAgentDynamicWorkflowSpecs(
  args: AgentDynamicWorkflowToolInput,
  getResumeItem: (agentId: string) => string | undefined,
): AgentDynamicWorkflowSpec[] {
  const resumeEntries = Object.entries(args.resume_agent_ids ?? {}).map(([agentId, prompt]) => ({
    agentId: agentId.trim(),
    prompt: prompt.trim(),
  }));
  const items = (args.items ?? []).map((item) => item.trim());
  const itemCount = items.length;
  const resumeCount = resumeEntries.length;
  const totalCount = resumeCount + itemCount;
  if (!hasMinimumAgentDynamicWorkflowInputs(itemCount, resumeCount)) {
    throw new Error('AgentDynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.');
  }
  if (totalCount > MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS) {
    throw new Error(`AgentDynamicWorkflow supports at most ${String(MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS)} subagents.`);
  }
  const promptTemplate = normalizeOptionalString(args.prompt_template);
  if (items.length > 0 && promptTemplate === undefined) {
    throw new Error('prompt_template is required when items are provided.');
  }
  if (promptTemplate !== undefined && !promptTemplate.includes(PROMPT_TEMPLATE_PLACEHOLDER)) {
    throw new Error(
      `prompt_template must include the ${PROMPT_TEMPLATE_PLACEHOLDER} placeholder.`,
    );
  }

  const seenPrompts = new Map<string, number>();
  const specs: AgentDynamicWorkflowSpec[] = [];
  for (const entry of resumeEntries) {
    specs.push({
      kind: 'resume',
      index: specs.length + 1,
      agentId: entry.agentId,
      item: getResumeItem(entry.agentId),
      prompt: entry.prompt,
    });
  }
  if (items.length > 0) {
    const itemPromptTemplate = promptTemplate!;
    items.forEach((item, index) => {
      const prompt = itemPromptTemplate.split(PROMPT_TEMPLATE_PLACEHOLDER).join(item);
      const previousIndex = seenPrompts.get(prompt);
      if (previousIndex !== undefined) {
        throw new Error(
          `Duplicate subagent prompts from items ${String(previousIndex)} and ${String(index + 1)}. AgentDynamicWorkflow requires distinct subagents.`,
        );
      }
      seenPrompts.set(prompt, index + 1);
      specs.push({
        kind: 'spawn',
        index: specs.length + 1,
        item,
        prompt,
      });
    });
  }
  return specs;
}

function hasMinimumAgentDynamicWorkflowInputs(itemCount: number, resumeCount: number): boolean {
  return resumeCount > 0 || itemCount >= 2;
}

function childDescription(dynamic_workflowDescription: string, index: number, profileName: string): string {
  return `${dynamic_workflowDescription} #${String(index)} (${profileName})`;
}

function renderDynamicWorkflowResults(results: readonly DynamicWorkflowRunResult[]): string {
  const completed = results.filter((result) => result.status === 'completed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const aborted = results.filter((result) => result.status === 'aborted').length;
  const shouldRenderResumeHint =
    results.some((result) => result.status !== 'completed') &&
    results.some((result) => result.agentId !== undefined);
  const lines = [
    '<agent_dynamic_workflow_result>',
    `<summary>${renderDynamicWorkflowSummary(completed, failed, aborted)}</summary>`,
  ];

  if (shouldRenderResumeHint) {
    lines.push(
      '<resume_hint>Call AgentDynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
    );
  }

  for (const result of results) {
    const agentId = result.agentId === undefined ? '' : ` agent_id="${result.agentId}"`;
    const mode = result.spec.kind === 'resume' ? ' mode="resume"' : '';
    const item = result.spec.item === undefined ? '' : ` item="${escapeXmlAttribute(result.spec.item)}"`;
    const state = result.state === undefined ? '' : ` state="${result.state}"`;
    const body = result.status === 'completed' ? (result.result ?? '') : (result.error ?? 'unknown error');
    lines.push(
      `<subagent${mode}${agentId}${item}${state} outcome="${result.status}">${body}</subagent>`,
    );
  }

  lines.push('</agent_dynamic_workflow_result>');
  return lines.join('\n');
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function renderDynamicWorkflowSummary(completed: number, failed: number, aborted = 0): string {
  const parts: string[] = [];
  if (completed > 0) parts.push(`completed: ${String(completed)}`);
  if (failed > 0) parts.push(`failed: ${String(failed)}`);
  if (aborted > 0) parts.push(`aborted: ${String(aborted)}`);
  return parts.join(', ');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
