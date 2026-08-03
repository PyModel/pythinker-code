import { ErrorCodes, PythinkerError } from '#/errors';
import type { BuiltinTool } from '#/agent/tool';
import type { ToolExecution } from '#/loop';

import { compileToolArgsValidator } from '../args-validator';

export const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput';
export const STRUCTURED_OUTPUT_REMINDER =
  'You MUST call the StructuredOutput tool to complete this request. Call it now with output matching the requested JSON Schema.';

const MAX_COMPLETION_REMINDERS = 5;

export class StructuredOutputState {
  readonly tool: StructuredOutputTool;
  output: unknown;
  hasOutput = false;
  private completionReminders = 0;

  constructor(readonly schema: Record<string, unknown>) {
    try {
      compileToolArgsValidator(schema);
    } catch (error) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `Invalid structured output JSON Schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.tool = new StructuredOutputTool(this);
  }

  requestCompletionReminder(): boolean {
    if (this.hasOutput || this.completionReminders >= MAX_COMPLETION_REMINDERS) {
      return false;
    }
    this.completionReminders += 1;
    return true;
  }

  setOutput(output: unknown): void {
    this.output = output;
    this.hasOutput = true;
  }
}

export class StructuredOutputTool implements BuiltinTool<unknown> {
  readonly name = STRUCTURED_OUTPUT_TOOL_NAME;
  readonly description =
    'Return the final response in the requested structured format. Call this tool exactly once at the end of the response.';
  readonly parameters: Record<string, unknown>;

  constructor(private readonly state: StructuredOutputState) {
    this.parameters = state.schema;
  }

  resolveExecution(args: unknown): ToolExecution {
    return {
      description: 'Returning structured output',
      approvalRule: this.name,
      stopBatchAfterThis: true,
      execute: async () => {
        this.state.setOutput(args);
        return {
          output: 'Structured output provided successfully.',
          stopTurn: true,
        };
      },
    };
  }
}
