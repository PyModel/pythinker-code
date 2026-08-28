import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const PROMPT_TEMPLATE_PLACEHOLDER = '{{item}}';
export const MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS = 128;

export const AgentDynamicWorkflowToolInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Short description for the whole dynamic workflow. It is shown to the user as the workflow and subagent title, so word it as a workflow or run and never use the word "swarm".',
      ),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Subagent type used for every new subagent spawned from items; defaults to coder when omitted. Resumed subagents always keep their original type, so passing subagent_type together with resume_agent_ids is allowed — it only affects the item-based spawns.',
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
    fork: z
      .boolean()
      .optional()
      .describe(
        'Fork the current context for every item-spawned subagent: each starts with a snapshot of this agent\'s completed conversation history instead of zero context, inheriting this agent\'s agent type, tool set, and model. A non-empty resume_agent_ids map is rejected. If subagent_type is provided, it must match this agent\'s type; if model is provided, it must be this agent\'s model or "primary". Different types and model overrides are rejected. Use it only when every item builds on this conversation; keep independent tasks zero-context.',
      ),
    resume_agent_ids: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional()
      .describe(
        'Map of existing subagent agent_id to the prompt used to resume that subagent. These resumed subagents are launched before new item-based subagents.',
      ),
    defaults: z
      .object({
        subagent_type: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional()
      .describe('Defaults applied to every entry of tasks that does not set its own value.'),
    tasks: z
      .array(
        z
          .object({
            item: z.string().trim().min(1).describe(`Value used to fill ${PROMPT_TEMPLATE_PLACEHOLDER} for this subagent.`),
            subagent_type: z.string().trim().min(1).optional().describe('Subagent type for this subagent; overrides defaults.subagent_type and subagent_type.'),
            model: z.string().optional().describe('Model alias for this subagent (same vocabulary as model); overrides model.'),
            thinking: z.string().optional().describe('Thinking effort for this subagent; overrides the model default.'),
          })
          .strict(),
      )
      .max(MAX_AGENT_DYNAMIC_WORKFLOW_SUBAGENTS)
      .optional()
      .describe(
        'Per-subagent entries with their own subagent_type, model, and thinking. Use instead of items when the subagents differ; tasks and items cannot be combined.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'Which model to run the item-spawned subagents on: one of the aliases listed under "Available models" in this tool description, or "primary" for the main model you are running on (for hard, quality-sensitive tasks). When omitted, the configured default model is used. Resumed subagents always keep their own model.',
      ),
  })
  .strict()
  .refine((input) => !(input.tasks !== undefined && input.items !== undefined), {
    message: 'tasks and items cannot be combined; use one of them.',
    path: ['tasks'],
  });

export type AgentDynamicWorkflowToolInput = z.infer<typeof AgentDynamicWorkflowToolInputSchema>;

export interface IAgentDynamicWorkflowTool extends AgentTool<AgentDynamicWorkflowToolInput> { readonly _serviceBrand: undefined }
export const IAgentDynamicWorkflowTool = createDecorator<IAgentDynamicWorkflowTool>('agentDynamicWorkflowTool');
