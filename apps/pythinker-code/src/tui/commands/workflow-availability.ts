import {
  resolveWorkflowSizeGuideline,
  type WorkflowSizeGuideline,
} from '@pymodel/pythinker-code-sdk';

const DISABLE_WORKFLOWS_ENV = 'PYTHINKER_CODE_DISABLE_WORKFLOWS';
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

let disabled = false;

/** Cache the resolved switch. Call once at startup with the value from `harness.getConfig()`. */
export function setDynamicWorkflowDisabled(configValue: boolean | undefined, env = process.env): void {
  const envValue = env[DISABLE_WORKFLOWS_ENV]?.trim().toLowerCase();
  if (envValue !== undefined && envValue.length > 0) {
    if (TRUE_ENV_VALUES.has(envValue)) {
      disabled = true;
      return;
    }
    if (FALSE_ENV_VALUES.has(envValue)) {
      disabled = false;
      return;
    }
  }
  disabled = configValue ?? false;
}

export function isDynamicWorkflowDisabled(): boolean {
  return disabled;
}

let sizeGuideline: WorkflowSizeGuideline | undefined;

/** Cache the resolved guideline. Call once at startup with the value from `harness.getConfig()`. */
export function setWorkflowSizeGuideline(
  configValue: WorkflowSizeGuideline | undefined,
  env = process.env,
): void {
  sizeGuideline = resolveWorkflowSizeGuideline({ workflowSizeGuideline: configValue }, env);
}

/** The guideline in force for this session, for surfaces that persist it (e.g. `/workflow save`). */
export function currentWorkflowSizeGuideline(): WorkflowSizeGuideline | undefined {
  return sizeGuideline;
}
