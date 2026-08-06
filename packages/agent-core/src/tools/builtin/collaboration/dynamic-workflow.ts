import { z } from 'zod';

import type { DynamicWorkflowMode } from '../../../agent/dynamic-workflow';
import type { BuiltinTool } from '../../../agent/tool';
import type {
  QueuedSubagentTask,
  SessionSubagentHost,
} from '../../../session/subagent-host';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { parseBooleanEnv, resolveConfigValue, type PythinkerConfig, type WorkflowSizeGuideline } from '../../../config';
import {
  DEFAULT_WORKFLOW_SIZE_GUIDELINE,
  workflowSizeGuidelineNote,
} from '../../../agent/dynamic-workflow/size-guideline';
import { generateWorkflowRunId } from '../../../agent/dynamic-workflow/run-id';
import { toInputJsonSchema } from '../../support/input-schema';
import DYNAMIC_WORKFLOW_DESCRIPTION from './dynamic-workflow.md?raw';

const DEFAULT_SUBAGENT_TYPE = 'coder';
const PROMPT_TEMPLATE_PLACEHOLDER = '{{item}}';
const MAX_DYNAMIC_WORKFLOW_SUBAGENTS = 128;

export const DISABLE_WORKFLOWS_ENV = 'PYTHINKER_CODE_DISABLE_WORKFLOWS';

/**
 * Dynamic Workflow is off when the env var says so, else when the config key says so.
 * Env wins so an operator can force it off without editing config.
 */
export function isDynamicWorkflowDisabled(
  config: Pick<PythinkerConfig, 'disableWorkflows'> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return resolveConfigValue({
    env,
    envKey: DISABLE_WORKFLOWS_ENV,
    configValue: config?.disableWorkflows,
    defaultValue: false,
    parseEnv: parseBooleanEnv,
  });
}

export const DynamicWorkflowToolInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .describe('Short description for the whole Dynamic Workflow.'),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Subagent type used for every spawned subagent. Defaults to coder when omitted.',
      ),
    prompt_template: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        `Optional prompt template for each subagent. The ${PROMPT_TEMPLATE_PLACEHOLDER} placeholder is replaced with each item value. When omitted, each item is used as a complete prompt.`,
      ),
    items: z
      .array(z.string().trim().min(1))
      .max(MAX_DYNAMIC_WORKFLOW_SUBAGENTS)
      .optional()
      .describe(
        `Each item launches one new subagent. Items fill ${PROMPT_TEMPLATE_PLACEHOLDER} when prompt_template is provided; otherwise they are complete prompts.`,
      ),
    resume_agent_ids: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional()
      .describe(
        'Map of existing subagent agent_id to the prompt used to resume that subagent. These resumed subagents are launched before new item-based subagents.',
      ),
    model: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Model alias for every subagent in this workflow, so the orchestrator can run on one model while the workers run on a cheaper or faster one. Defaults to the subagent type profile model, then this agent model.',
      ),
    effort: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Reasoning effort for every subagent in this workflow. Defaults to the subagent type profile effort, then this agent effort.',
      ),
  })
  .strict();

export type DynamicWorkflowToolInput = z.infer<typeof DynamicWorkflowToolInputSchema>;

interface DynamicWorkflowSpawnSpec {
  readonly kind: 'spawn';
  readonly index: number;
  readonly item: string;
  readonly prompt: string;
}

interface DynamicWorkflowResumeSpec {
  readonly kind: 'resume';
  readonly index: number;
  readonly agentId: string;
  readonly item?: string;
  readonly prompt: string;
}

type DynamicWorkflowSpec = DynamicWorkflowSpawnSpec | DynamicWorkflowResumeSpec;

interface DynamicWorkflowRunResult {
  readonly spec: DynamicWorkflowSpec;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly error?: string;
}

export class DynamicWorkflowTool implements BuiltinTool<DynamicWorkflowToolInput> {
  readonly name = 'DynamicWorkflow' as const;
  readonly description: string;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(DynamicWorkflowToolInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly dynamicWorkflowMode: DynamicWorkflowMode,
    sizeGuideline: WorkflowSizeGuideline = DEFAULT_WORKFLOW_SIZE_GUIDELINE,
  ) {
    const sizeNote = workflowSizeGuidelineNote(sizeGuideline);
    this.description =
      sizeNote === undefined
        ? DYNAMIC_WORKFLOW_DESCRIPTION
        : `${DYNAMIC_WORKFLOW_DESCRIPTION}\n\n${sizeNote}`;
  }

  resolveExecution(args: DynamicWorkflowToolInput): ToolExecution {
    const agentCount = (args.items?.length ?? 0) + Object.keys(args.resume_agent_ids ?? {}).length;
    return {
      accesses: ToolAccesses.all(),
      description: `Launching Dynamic Workflow: ${args.description}`,
      display: {
        kind: 'agent_call',
        agent_name: `Dynamic Workflow (${agentCount} subagents)`,
        prompt: args.description,
      },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: DynamicWorkflowToolInput,
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
    args: DynamicWorkflowToolInput,
    signal: AbortSignal,
    toolCallId: string,
  ): Promise<string> {
    const profileName = normalizeOptionalString(args.subagent_type) ?? DEFAULT_SUBAGENT_TYPE;
    const specs = createDynamicWorkflowSpecs(args, (agentId) => this.subagentHost.getDynamicWorkflowItem(agentId));
    const runId = generateWorkflowRunId();
    // Workflow tasks intentionally carry no timeout: they run until they
    // complete, fail, or the user cancels (see dynamic-workflow.md).
    const tasks = specs.map((spec): QueuedSubagentTask<DynamicWorkflowSpec> => {
      const descriptionName = spec.kind === 'resume' ? 'resume' : profileName;
      const common = {
        data: spec,
        profileName: spec.kind === 'resume' ? 'subagent' : profileName,
        parentToolCallId: toolCallId,
        prompt: spec.prompt,
        description: childDescription(args.description, spec.index, descriptionName),
        dynamicWorkflowIndex: spec.index,
        runInBackground: false,
        dynamicWorkflowItem: spec.item,
        // Undefined falls through to the profile, then the parent agent, in
        // SessionSubagentHost — so a workflow can run its workers on a
        // different model (and provider) than the orchestrating agent.
        modelAlias: normalizeOptionalString(args.model),
        thinkingLevel: normalizeOptionalString(args.effort),
        // One id per call, shared by every subagent and reported back as run_id.
        workflowRunId: runId,
        signal,
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
    return renderDynamicWorkflowResults(
      results.map(({ task, ...result }) => ({ spec: task.data, ...result })),
      runId,
    );
  }
}

function createDynamicWorkflowSpecs(
  args: DynamicWorkflowToolInput,
  getResumeItem: (agentId: string) => string | undefined,
): DynamicWorkflowSpec[] {
  const resumeEntries = Object.entries(args.resume_agent_ids ?? {}).map(([agentId, prompt]) => ({
    agentId: agentId.trim(),
    prompt: prompt.trim(),
  }));
  const items = (args.items ?? []).map((item) => item.trim());
  const itemCount = items.length;
  const resumeCount = resumeEntries.length;
  const totalCount = resumeCount + itemCount;
  if (!hasMinimumDynamicWorkflowInputs(itemCount, resumeCount)) {
    throw new Error('DynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.');
  }
  if (totalCount > MAX_DYNAMIC_WORKFLOW_SUBAGENTS) {
    throw new Error(`DynamicWorkflow supports at most ${String(MAX_DYNAMIC_WORKFLOW_SUBAGENTS)} subagents.`);
  }
  const promptTemplate = normalizeOptionalString(args.prompt_template);
  if (promptTemplate !== undefined && !promptTemplate.includes(PROMPT_TEMPLATE_PLACEHOLDER)) {
    throw new Error(
      `prompt_template must include the ${PROMPT_TEMPLATE_PLACEHOLDER} placeholder.`,
    );
  }

  const seenPrompts = new Map<string, number>();
  const specs: DynamicWorkflowSpec[] = [];
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
    items.forEach((item, index) => {
      const prompt = promptTemplate === undefined
        ? item
        : promptTemplate.split(PROMPT_TEMPLATE_PLACEHOLDER).join(item);
      const previousIndex = seenPrompts.get(prompt);
      if (previousIndex !== undefined) {
        throw new Error(
          `Duplicate subagent prompts from items ${String(previousIndex)} and ${String(index + 1)}. DynamicWorkflow requires distinct subagents.`,
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

function hasMinimumDynamicWorkflowInputs(itemCount: number, resumeCount: number): boolean {
  return resumeCount > 0 || itemCount >= 2;
}

function childDescription(workflowDescription: string, index: number, profileName: string): string {
  return `${workflowDescription} #${String(index)} (${profileName})`;
}

// Render results as an XML block that the consumer parses, so every
// interpolated value (agent ids, item names, result/error bodies — all user
// data) must be escaped; an unescaped `<` or `>` would break the structure.
function renderDynamicWorkflowResults(
  results: readonly DynamicWorkflowRunResult[],
  runId: string,
): string {
  const completed = results.filter((result) => result.status === 'completed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const aborted = results.filter((result) => result.status === 'aborted').length;
  const shouldRenderResumeHint = results.some(
    (result) => result.status !== 'completed' && result.agentId !== undefined,
  );
  const lines = [
    `<dynamic_workflow_result run_id="${escapeXml(runId)}">`,
    `<summary>${renderDynamicWorkflowSummary(completed, failed, aborted)}</summary>`,
  ];

  if (shouldRenderResumeHint) {
    lines.push(
      '<resume_hint>Call DynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
    );
  }

  for (const result of results) {
    const agentId = result.agentId === undefined ? '' : ` agent_id="${escapeXml(result.agentId)}"`;
    const mode = result.spec.kind === 'resume' ? ' mode="resume"' : '';
    const item = result.spec.item === undefined ? '' : ` item="${escapeXml(result.spec.item)}"`;
    const state = result.state === undefined ? '' : ` state="${result.state}"`;
    const body = result.status === 'completed' ? (result.result ?? '') : (result.error ?? 'unknown error');
    lines.push(
      `<subagent${mode}${agentId}${item}${state} outcome="${result.status}">${escapeXml(body)}</subagent>`,
    );
  }

  lines.push('</dynamic_workflow_result>');
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

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
