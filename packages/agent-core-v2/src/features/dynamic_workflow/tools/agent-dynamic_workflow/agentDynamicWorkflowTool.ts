import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';
import { Error2, ErrorCodes } from '#/errors';
import { toInputJsonSchema } from '#/tool/input-schema';
import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { ISessionDynamicWorkflowService, type SessionDynamicWorkflowTask } from '#/features/dynamic_workflow/session/sessionDynamicWorkflow';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { ISessionSubagentService } from '#/session/subagent/subagent';
import {
  FORK_EXPERIMENTAL_UNAVAILABLE,
  FORK_WITH_RESUME_UNAVAILABLE,
  forkIncompatibility,
  type SubagentSpawnPlan,
} from '#/session/subagent/spawn';
import { SUBAGENT_FORK_FLAG_ID } from '#/session/subagent/flag';
import {
  buildSubagentModelDescriptions,
  exposesSubagentModelChoice,
  resolveSubagentTimeoutMs,
  stripSubagentForkParameter,
  stripSubagentModelParameter,
} from '#/session/subagent/configSection';
import {
  AgentDynamicWorkflowToolInputSchema,
  IAgentDynamicWorkflowTool,
  MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS,
  PROMPT_TEMPLATE_PLACEHOLDER,
  type AgentDynamicWorkflowToolInput,
} from './agent-dynamic_workflow';
import AGENT_DYNAMIC_WORKFLOW_DESCRIPTION from './agent-dynamic_workflow.md?raw';
import AGENT_DYNAMIC_WORKFLOW_FORK_DESCRIPTION from './agent-dynamic-workflow-fork.md?raw';

const DEFAULT_SUBAGENT_TYPE = 'coder';

const AGENT_DYNAMIC_WORKFLOW_PARAMETERS = toInputJsonSchema(AgentDynamicWorkflowToolInputSchema);
const AGENT_DYNAMIC_WORKFLOW_PARAMETERS_NO_MODEL = stripSubagentModelParameter(AGENT_DYNAMIC_WORKFLOW_PARAMETERS);

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

export class AgentDynamicWorkflowTool implements IAgentDynamicWorkflowTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'AgentDynamicWorkflow' as const;

  get parameters(): Record<string, unknown> {
    const parameters = exposesSubagentModelChoice(this.config, this.flags)
      ? AGENT_DYNAMIC_WORKFLOW_PARAMETERS
      : AGENT_DYNAMIC_WORKFLOW_PARAMETERS_NO_MODEL;
    return this.flags.enabled(SUBAGENT_FORK_FLAG_ID)
      ? parameters
      : stripSubagentForkParameter(parameters);
  }

  private readonly callerAgentId: string;

  constructor(
    @ISessionDynamicWorkflowService private readonly dynamicWorkflowService: ISessionDynamicWorkflowService,
    @IAgentScopeContext scopeContext: IAgentScopeContext,
    @IAgentDynamicWorkflowService private readonly dynamicWorkflowMode: IAgentDynamicWorkflowService,
    @IConfigService private readonly config: IConfigService,
    @IFlagService private readonly flags: IFlagService,
    @ISessionSubagentService private readonly subagents: ISessionSubagentService,
    @IAgentProfileService private readonly profile: IAgentProfileService,
  ) {
    this.callerAgentId = scopeContext.agentId;
  }

  get description(): string {
    let description = AGENT_DYNAMIC_WORKFLOW_DESCRIPTION;
    if (this.flags.enabled(SUBAGENT_FORK_FLAG_ID)) {
      description += `\n\n${AGENT_DYNAMIC_WORKFLOW_FORK_DESCRIPTION}`;
    }
    const modelLines = buildSubagentModelDescriptions(
      this.config,
      this.flags,
      this.profile.data().modelAlias,
    );
    return modelLines === undefined ? description : `${description}\n\n${modelLines}`;
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
    const fork = args.fork === true;
    if (fork && !this.flags.enabled(SUBAGENT_FORK_FLAG_ID)) {
      throw new Error2(ErrorCodes.VALIDATION_FAILED, FORK_EXPERIMENTAL_UNAVAILABLE);
    }
    if (fork && Object.keys(args.resume_agent_ids ?? {}).length > 0) {
      throw new Error2(ErrorCodes.VALIDATION_FAILED, FORK_WITH_RESUME_UNAVAILABLE);
    }
    let plan: SubagentSpawnPlan | undefined;
    if ((args.items?.length ?? 0) > 0) {
      if (fork) {
        const incompatible = forkIncompatibility(
          { subagent_type: args.subagent_type, model: args.model },
          this.profile.data(),
        );
        if (incompatible !== undefined) {
          throw new Error2(ErrorCodes.VALIDATION_FAILED, incompatible);
        }
      }
      plan = await this.subagents.planSpawn({
        callerAgentId: this.callerAgentId,
        profileName: args.subagent_type,
        model: args.model,
        fork,
      });
    }
    const profileName = plan?.profileName ?? DEFAULT_SUBAGENT_TYPE;
    const timeoutMs = resolveSubagentTimeoutMs(this.config);
    const specs = await createAgentDynamicWorkflowSpecs(args, (agentId) =>
      this.dynamicWorkflowService.getDynamicWorkflowItem({ callerAgentId: this.callerAgentId, agentId }),
    );
    const tasks: SessionDynamicWorkflowTask<AgentDynamicWorkflowSpec>[] = specs.map((spec) => {
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
        signal,
        timeout: timeoutMs,
      };
      if (spec.kind === 'resume') {
        return {
          ...common,
          kind: 'resume' as const,
          resumeAgentId: spec.agentId,
        };
      }
      return {
        ...common,
        kind: 'spawn' as const,
        plan: plan!,
      };
    });
    const results = await this.dynamicWorkflowService.run({
      callerAgentId: this.callerAgentId,
      tasks,
    });
    return renderDynamicWorkflowResults(
      results.map(({ task, ...result }) => ({ spec: task.data, ...result })),
    );
  }
}

async function createAgentDynamicWorkflowSpecs(
  args: AgentDynamicWorkflowToolInput,
  getResumeItem: (agentId: string) => Promise<string | undefined>,
): Promise<AgentDynamicWorkflowSpec[]> {
  const resumeEntries = Object.entries(args.resume_agent_ids ?? {}).map(([agentId, prompt]) => ({
    agentId: agentId.trim(),
    prompt: prompt.trim(),
  }));
  const items = (args.items ?? []).map((item) => item.trim());
  const itemCount = items.length;
  const resumeCount = resumeEntries.length;
  const totalCount = resumeCount + itemCount;
  if (!hasMinimumAgentDynamicWorkflowInputs(itemCount, resumeCount)) {
    throw new Error2(
      ErrorCodes.VALIDATION_FAILED,
      'AgentDynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.',
    );
  }
  if (totalCount > MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS) {
    throw new Error2(
      ErrorCodes.VALIDATION_FAILED,
      `AgentDynamicWorkflow supports at most ${String(MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS)} subagents.`,
      { details: { total: totalCount, max: MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS } },
    );
  }
  const promptTemplate = normalizeOptionalString(args.prompt_template);
  if (items.length > 0 && promptTemplate === undefined) {
    throw new Error2(
      ErrorCodes.VALIDATION_FAILED,
      'prompt_template is required when items are provided.',
    );
  }
  if (promptTemplate !== undefined && !promptTemplate.includes(PROMPT_TEMPLATE_PLACEHOLDER)) {
    throw new Error2(
      ErrorCodes.VALIDATION_FAILED,
      `prompt_template must include the ${PROMPT_TEMPLATE_PLACEHOLDER} placeholder.`,
      { details: { placeholder: PROMPT_TEMPLATE_PLACEHOLDER } },
    );
  }

  const seenPrompts = new Map<string, number>();
  const specs: AgentDynamicWorkflowSpec[] = [];
  for (const entry of resumeEntries) {
    specs.push({
      kind: 'resume',
      index: specs.length + 1,
      agentId: entry.agentId,
      item: await getResumeItem(entry.agentId),
      prompt: entry.prompt,
    });
  }
  if (items.length > 0) {
    const itemPromptTemplate = promptTemplate!;
    items.forEach((item, index) => {
      const prompt = itemPromptTemplate.split(PROMPT_TEMPLATE_PLACEHOLDER).join(item);
      const previousIndex = seenPrompts.get(prompt);
      if (previousIndex !== undefined) {
        throw new Error2(
          ErrorCodes.VALIDATION_FAILED,
          `Duplicate subagent prompts from items ${String(previousIndex)} and ${String(index + 1)}. AgentDynamicWorkflow requires distinct subagents.`,
          { details: { previousIndex, index: index + 1 } },
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

function childDescription(dynamicWorkflowDescription: string, index: number, profileName: string): string {
  return `${dynamicWorkflowDescription} #${String(index)} (${profileName})`;
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
