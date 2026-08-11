import type { ExecutableTool } from './types';

export const INTENT_FIELD = 'i';
export const INTENT_MAX_LENGTH = 120;
/** Tool names excluded from intent injection. StructuredOutput is mechanical and has an exact schema contract. */
export const INTENT_OMIT_TOOLS: ReadonlySet<string> = new Set(['StructuredOutput']);

// oxlint-disable-next-line no-control-regex -- model-authored terminal text must not retain escape sequences.
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|$))/gu;
const CONTROL_CHARACTER = /\p{Cc}/gu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function isIntentInjected(tool: ExecutableTool): boolean {
  if (INTENT_OMIT_TOOLS.has(tool.name) || !isPlainRecord(tool.parameters)) return false;
  const properties = tool.parameters['properties'];
  return isPlainRecord(properties) && !Object.hasOwn(properties, INTENT_FIELD);
}

export function injectIntentIntoTools(tools: readonly ExecutableTool[]): ExecutableTool[] {
  return tools.map((tool) => {
    if (!isIntentInjected(tool)) return tool;
    const schema = tool.parameters;
    const properties = schema['properties'] as Record<string, unknown>;
    const required = Array.isArray(schema['required']) ? schema['required'] : [];
    return {
      ...tool,
      parameters: {
        ...schema,
        properties: {
          [INTENT_FIELD]: { type: 'string', description: 'concise intent' },
          ...properties,
        },
        required: [INTENT_FIELD, ...required],
      },
      resolveExecution: tool.resolveExecution.bind(tool),
    };
  });
}

export function extractIntentFromArgs(args: unknown): {
  args: unknown;
  intent: string | undefined;
} {
  if (!isPlainRecord(args) || typeof args[INTENT_FIELD] !== 'string') {
    return { args, intent: undefined };
  }
  const { [INTENT_FIELD]: rawIntent, ...rest } = args;
  return { args: rest, intent: sanitizeIntent(rawIntent as string) };
}

export function sanitizeIntent(raw: string): string | undefined {
  const normalized = raw
    .replaceAll(ANSI_ESCAPE, '')
    .replaceAll(CONTROL_CHARACTER, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  const capped = Array.from(normalized).slice(0, INTENT_MAX_LENGTH).join('').trimEnd();
  return capped.length > 0 ? capped : undefined;
}
