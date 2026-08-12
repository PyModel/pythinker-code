import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { WorkflowWarningEvent } from '@pythoughts/protocol';

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
  workflowSizeGuidelineTarget,
} from '../../../agent/dynamic-workflow/size-guideline';
import { generateWorkflowRunId } from '../../../agent/dynamic-workflow/run-id';
import { estimateTokens } from '../../../utils/tokens';
import { toInputJsonSchema } from '../../support/input-schema';
import {
  literalRulePattern,
  matchesGlobRuleSubjects,
  modelRuleSubject,
} from '../../support/rule-match';
import DYNAMIC_WORKFLOW_DESCRIPTION from './dynamic-workflow.md?raw';

const DEFAULT_SUBAGENT_TYPE = 'coder';
const PROMPT_TEMPLATE_PLACEHOLDER = '{{item}}';
const MAX_DYNAMIC_WORKFLOW_SUBAGENTS = 128;
/**
 * Warning threshold when the operator chose `unrestricted`, so even an
 * unrestricted operator still hears about a very large fan-out.
 */
const UNRESTRICTED_WARNING_THRESHOLD = 25;

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
      // Deliberately unconstrained per item and unbounded in length: argument
      // validation rejects the WHOLE call before the tool runs, so a trailing
      // empty string — or one blank entry pushing a full list one over the cap
      // — would cost a re-send of every prompt. The tool drops blanks, reports
      // how many, and enforces the real cap against the surviving count.
      .array(z.string())
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
        'Model alias for every subagent in this workflow, so the orchestrator can run on one model while the workers run on a cheaper or faster one. References such as @small, @implementer, @advisor, and @<custom-role> resolve through configured model roles and fall back to normal precedence when unassigned. Defaults to the subagent type profile model, then the configured implementer model role, then this agent model.',
      ),
    effort: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Reasoning effort for every subagent in this workflow. Defaults to the subagent type profile effort, then this agent effort.',
      ),
    output_schema: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'JSON Schema every subagent in this workflow must satisfy. Each subagent returns its result by calling the StructuredOutput tool instead of writing a prose summary. A subagent that cannot produce conforming output is reported with outcome="schema_error" and does not fail the batch.',
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
  readonly status: 'completed' | 'failed' | 'aborted' | 'schema_error';
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
    private readonly sizeGuideline: WorkflowSizeGuideline = DEFAULT_WORKFLOW_SIZE_GUIDELINE,
    private readonly emitEvent?: (event: WorkflowWarningEvent) => void,
  ) {
    const sizeNote = workflowSizeGuidelineNote(this.sizeGuideline);
    this.description =
      sizeNote === undefined
        ? DYNAMIC_WORKFLOW_DESCRIPTION
        : `${DYNAMIC_WORKFLOW_DESCRIPTION}\n\n${sizeNote}`;
  }

  resolveExecution(args: DynamicWorkflowToolInput): ToolExecution {
    const workflow = dynamicWorkflowPreview(args);
    const approvalSubject = dynamicWorkflowApprovalSubject(args, workflow);
    return {
      accesses: ToolAccesses.all(),
      description: `Launching Dynamic Workflow: ${args.description}`,
      display: {
        kind: 'agent_call',
        agent_name: `Dynamic Workflow (${String(workflow.agent_count)} subagents)`,
        prompt: args.description,
        workflow,
      },
      // Keyed on the whole plan, not the tool name and not the description.
      // The bare name granted every future DynamicWorkflow call; the
      // description alone would let a second call reuse it and swap in 128
      // different items, which is exactly the fan-out the preview exists to
      // show. "Approve for this session" now grants the plan that was shown.
      // The matcher has to ship with it: an arg-bearing rule with no
      // `matchesRule` never matches, so the grant would be recorded and then
      // silently ignored on every later call.
      approvalRule: literalRulePattern(this.name, approvalSubject),
      // The model this workflow asked its subagents to use is a second subject,
      // so `DynamicWorkflow(model:opus)` constrains a fan-out that would
      // otherwise run 128 children on any model the provider can resolve.
      matchesRule: (ruleArgs) =>
        matchesGlobRuleSubjects(ruleArgs, [approvalSubject, ...modelRuleSubject(args.model)]),
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
    const threshold =
      workflowSizeGuidelineTarget(this.sizeGuideline) ?? UNRESTRICTED_WARNING_THRESHOLD;
    if (specs.length > threshold) {
      this.emitEvent?.({
        type: 'workflow.warning',
        workflowRunId: runId,
        parentToolCallId: toolCallId,
        agentCount: specs.length,
        threshold,
        message: `This Dynamic Workflow will launch ${String(specs.length)} subagents, above the advisory ceiling of ${String(threshold)}; the run is proceeding anyway.`,
      });
    }
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
        // The workflow's user-facing description, repeated on each subagent.
        workflowName: args.description,
        // One schema for the whole workflow: every item runs the same prompt
        // template, so a per-item schema is not expressible in this contract.
        outputSchema: args.output_schema,
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
    const rendered = renderDynamicWorkflowResults(
      results.map(({ task, ...result }) => ({ spec: task.data, ...result })),
      runId,
    );
    const { dropped } = normalizeWorkflowItems(args.items);
    if (dropped === 0) return rendered;
    // After the envelope, never before it: consumers match the result document
    // anchored at the start of the output, so a prefix makes a successful run
    // parse as an unsupported result.
    return `${rendered}\n${droppedItemsNote(dropped)}`;
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
  const { items, dropped } = normalizeWorkflowItems(args.items);
  const itemCount = items.length;
  const resumeCount = resumeEntries.length;
  const totalCount = resumeCount + itemCount;
  if (!hasMinimumDynamicWorkflowInputs(itemCount, resumeCount)) {
    // Name the dropped items here: without it the caller reads "requires at
    // least 2 items" while looking at a list that had enough entries.
    const droppedNote = dropped === 0 ? '' : ` ${droppedItemsNote(dropped)}`;
    throw new Error(
      `DynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.${droppedNote}`,
    );
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
      const prompt = renderItemPrompt(item, promptTemplate);
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

/**
 * What the call is about to launch, for the approval panel — the counted
 * subagents, the work each one gets, and how much prompt that adds up to.
 *
 * Built from the arguments alone and deliberately total: `resolveExecution`
 * runs before `createDynamicWorkflowSpecs` validates anything, so a call this
 * function threw on would never reach the panel that exists to refuse it.
 * `prompt_tokens` is the summed prompt estimate, which is a real input size —
 * not a guess at what the run will finally cost.
 */
function dynamicWorkflowPreview(args: DynamicWorkflowToolInput): {
  agent_count: number;
  items: string[];
  prompt_tokens: number;
  prompt_template?: string;
  model?: string;
} {
  const { items } = normalizeWorkflowItems(args.items);
  const promptTemplate = normalizeOptionalString(args.prompt_template);
  const resumeIds = Object.keys(args.resume_agent_ids ?? {});
  const prompts = [
    ...Object.values(args.resume_agent_ids ?? {}),
    ...items.map((item) => renderItemPrompt(item, promptTemplate)),
  ];
  return {
    agent_count: prompts.length,
    // Resumed subagents carry an id rather than an item, so label them to keep
    // the list the same length as the count it sits under. The prompt goes in
    // too: it is the instruction that subagent will actually receive, and the
    // approval digest is built from this list — an id alone would let a second
    // call keep the same ids, change what it tells them to do, and match the
    // earlier grant.
    items: [
      ...resumeIds.map(
        (agentId) => `resume ${agentId}: ${(args.resume_agent_ids ?? {})[agentId] ?? ''}`,
      ),
      ...items,
    ],
    prompt_tokens: prompts.reduce((total, prompt) => total + estimateTokens(prompt), 0),
    prompt_template: promptTemplate,
    model: normalizeOptionalString(args.model),
  };
}

/**
 * Characters a permission-rule subject can carry safely. The rule DSL parses
 * `Tool(subject)` by splitting on the first paren, and the subject is then glob
 * matched — so parens break parsing outright and `{}[]*?!+@|` survive neither
 * escaping nor picomatch reliably. Everything else is dropped from the readable
 * half of the subject; the digest carries the precision.
 */
const RULE_SUBJECT_UNSAFE = /[^a-zA-Z0-9 ._-]/gu;

/**
 * Subject a session approval is recorded against: a readable prefix plus a
 * digest of the whole plan.
 *
 * Every field that changes what actually runs feeds the digest, the item list
 * included. Keying on the description alone would let a later call keep the
 * description, swap in a different 128-item list, and ride in on the earlier
 * grant — the precise fan-out the preview exists to expose. Two plans share a
 * grant only when they would launch the same work.
 *
 * The plan cannot be the subject verbatim: a JSON blob does not survive the
 * rule DSL. Hence digest, with a trimmed description kept in front so a
 * recorded rule is still recognisable.
 */
function dynamicWorkflowApprovalSubject(
  args: DynamicWorkflowToolInput,
  workflow: { readonly items: readonly string[]; readonly agent_count: number },
): string {
  const plan = JSON.stringify({
    description: args.description,
    subagentType: normalizeOptionalString(args.subagent_type),
    promptTemplate: normalizeOptionalString(args.prompt_template),
    model: normalizeOptionalString(args.model),
    effort: normalizeOptionalString(args.effort),
    outputSchema: args.output_schema,
    agentCount: workflow.agent_count,
    items: workflow.items,
  });
  const digest = createHash('sha256').update(plan).digest('hex').slice(0, 16);
  const label = args.description.replace(RULE_SUBJECT_UNSAFE, ' ').trim();
  return label.length === 0 ? digest : `${label} ${digest}`;
}

function renderItemPrompt(item: string, promptTemplate: string | undefined): string {
  return promptTemplate === undefined
    ? item
    : promptTemplate.split(PROMPT_TEMPLATE_PLACEHOLDER).join(item);
}

/**
 * Trims items and drops the blank ones, reporting how many went.
 *
 * Models routinely emit a trailing empty string when building the list. Per
 * item that is not worth failing the call over — but it is worth saying out
 * loud, because a silently shorter workflow looks identical to one the model
 * sized correctly.
 */
function normalizeWorkflowItems(raw: readonly string[] | undefined): {
  items: string[];
  dropped: number;
} {
  const trimmed = (raw ?? []).map((item) => item.trim());
  const items = trimmed.filter((item) => item.length > 0);
  return { items, dropped: trimmed.length - items.length };
}

function droppedItemsNote(dropped: number): string {
  const plural = dropped === 1 ? 'item was' : 'items were';
  return `Note: ${String(dropped)} empty ${plural} ignored; the workflow ran without them.`;
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
  const schemaError = results.filter((result) => result.status === 'schema_error').length;
  const shouldRenderResumeHint = results.some(
    (result) => result.status !== 'completed' && result.agentId !== undefined,
  );
  const lines = [
    `<dynamic_workflow_result run_id="${escapeXml(runId)}">`,
    `<summary>${renderDynamicWorkflowSummary(completed, failed, aborted, schemaError)}</summary>`,
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

function renderDynamicWorkflowSummary(
  completed: number,
  failed: number,
  aborted = 0,
  schemaError = 0,
): string {
  const parts: string[] = [];
  if (completed > 0) parts.push(`completed: ${String(completed)}`);
  if (failed > 0) parts.push(`failed: ${String(failed)}`);
  if (aborted > 0) parts.push(`aborted: ${String(aborted)}`);
  // A schema_error child DID run, so it is neither completed nor aborted;
  // it is counted separately and rendered with outcome="schema_error".
  if (schemaError > 0) parts.push(`schema_error: ${String(schemaError)}`);
  return parts.join(', ');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
