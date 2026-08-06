import { resolveConfigValue, type PythinkerConfig, type WorkflowSizeGuideline } from '../../config';

export const WORKFLOW_SIZE_GUIDELINE_ENV = 'PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE';

export const DEFAULT_WORKFLOW_SIZE_GUIDELINE: WorkflowSizeGuideline = 'medium';

/** Advisory subagent-count target per guideline. `unrestricted` has none. */
const GUIDELINE_TARGETS: Record<WorkflowSizeGuideline, number | undefined> = {
  small: 5,
  medium: 15,
  large: 40,
  unrestricted: undefined,
};

const WORKFLOW_SIZE_GUIDELINE_NAMES = new Set<string>([
  'small',
  'medium',
  'large',
  'unrestricted',
]);

function parseWorkflowSizeGuidelineEnv(value: string | undefined): WorkflowSizeGuideline | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || !WORKFLOW_SIZE_GUIDELINE_NAMES.has(normalized)) return undefined;
  return normalized as WorkflowSizeGuideline;
}

export function resolveWorkflowSizeGuideline(
  config: Pick<PythinkerConfig, 'workflowSizeGuideline'> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowSizeGuideline {
  return resolveConfigValue({
    env,
    envKey: WORKFLOW_SIZE_GUIDELINE_ENV,
    configValue: config?.workflowSizeGuideline,
    defaultValue: DEFAULT_WORKFLOW_SIZE_GUIDELINE,
    parseEnv: parseWorkflowSizeGuidelineEnv,
  });
}

/**
 * Note appended to the model-facing Dynamic Workflow guidance, or `undefined` for
 * `unrestricted` (which keeps the existing decompose-freely wording).
 *
 * The base guidance tells the model to decompose as finely as possible, so the note has to
 * say out loud that it supersedes that — otherwise the model reads two conflicting targets.
 */
export function workflowSizeGuidelineNote(guideline: WorkflowSizeGuideline): string | undefined {
  const target = GUIDELINE_TARGETS[guideline];
  if (target === undefined) return undefined;
  return `Workflow size guideline: this supersedes the guidance above about decomposing as finely as possible. Unless the user explicitly asks for more, aim for at most about ${String(target)} subagents in one workflow, preferring fewer, larger items over many tiny ones.`;
}
