import {
  StartPermissionPromptComponent,
  type StartPermissionOption,
} from './start-permission-prompt';

export type DynamicWorkflowStartPermissionChoice = 'auto' | 'yolo' | 'manual';

export interface DynamicWorkflowStartPermissionPromptOptions {
  readonly onSelect: (choice: DynamicWorkflowStartPermissionChoice) => void;
  readonly onCancel: () => void;
}

const OPTIONS: readonly StartPermissionOption<DynamicWorkflowStartPermissionChoice>[] = [
  {
    value: 'auto',
    label: 'Switch to Auto and start',
    description:
      'Best for Dynamic Workflow tasks. Tools are approved automatically, and questions are skipped.',
  },
  {
    value: 'yolo',
    label: 'Switch to YOLO and start',
    description:
      'Tools and plan changes are approved automatically. Pythinker Code may still ask you questions.',
  },
  {
    value: 'manual',
    label: 'Start in Manual',
    description:
      'Keep approvals on. Pythinker Code may stop and wait for you during the Dynamic Workflow task.',
  },
];

const NOTICE_LINES = [
  'Manual mode asks you before Pythinker Code runs commands, edits files, or takes other risky actions.',
  'Manual mode can block Dynamic Workflow work while agents are running.',
  'You can go back without losing your command.',
] as const;

export class DynamicWorkflowStartPermissionPromptComponent extends StartPermissionPromptComponent<DynamicWorkflowStartPermissionChoice> {
  constructor(opts: DynamicWorkflowStartPermissionPromptOptions) {
    super({
      title: 'Start a Dynamic Workflow task with approvals on?',
      noticeLines: NOTICE_LINES,
      options: OPTIONS,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
