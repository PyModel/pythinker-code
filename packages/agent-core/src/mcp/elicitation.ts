import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

import type {
  QuestionAnswers,
  QuestionItem,
  QuestionResult,
  SDKSessionRPC,
} from '../rpc';

const MAX_QUESTIONS_PER_REQUEST = 4;
const SKIP_LABEL = 'Skip this field';
const OPEN_URL_LABEL = 'Open URL';
const DECLINE_LABEL = 'Decline';
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

interface FormField {
  readonly name: string;
  readonly schema: PrimitiveSchemaDefinition;
  readonly required: boolean;
}

interface FieldQuestion {
  readonly field: FormField;
  readonly question: QuestionItem;
  readonly optionValues: readonly (string | boolean | undefined)[];
}

const invalidAnswer = Symbol('invalid MCP elicitation answer');
const skippedAnswer = Symbol('skipped MCP elicitation answer');

export async function requestMcpFormElicitation(
  serverName: string,
  params: ElicitRequestFormParams,
  requestId: string | number,
  signal: AbortSignal,
  rpc: SDKSessionRPC,
): Promise<ElicitResult> {
  const required = new Set(params.requestedSchema.required ?? []);
  const fields = Object.entries(params.requestedSchema.properties).map(
    ([name, schema]): FormField => ({
      name,
      schema,
      required: required.has(name),
    }),
  );
  if (fields.length === 0) return { action: 'accept', content: {} };

  const validate =
    new AjvJsonSchemaValidator().getValidator<Record<string, string | number | boolean | string[]>>(
      params.requestedSchema,
    );
  const content: Record<string, string | number | boolean | string[]> = {};
  let validationError: string | undefined;

  while (true) {
    let parseError: string | undefined;
    for (let offset = 0; offset < fields.length; offset += MAX_QUESTIONS_PER_REQUEST) {
      signal.throwIfAborted();
      const chunk: FieldQuestion[] = [];
      const pageFields = fields.slice(offset, offset + MAX_QUESTIONS_PER_REQUEST);
      for (let index = 0; index < pageFields.length; index++) {
        const field = pageFields[index]!;
        chunk.push(
          buildFieldQuestion(
            field,
            params.message,
            offset === 0 && index === 0 ? validationError : undefined,
          ),
        );
      }
      const result = await rpc.requestQuestion(
        {
          agentId: 'main',
          toolCallId: `mcp-elicitation:${serverName}:${String(requestId)}:${String(offset)}`,
          questions: chunk.map((item) => item.question),
        },
        { signal },
      );
      const answers = questionAnswers(result);
      if (answers === null) return { action: 'cancel' };

      for (let index = 0; index < chunk.length; index++) {
        const item = chunk[index]!;
        const raw = answers[item.question.question] ?? answers[`q_${String(index)}`];
        if (raw === undefined) continue;
        const parsed = parseFieldAnswer(item, raw, index);
        if (parsed === invalidAnswer) {
          delete content[item.field.name];
          parseError = `Invalid value for ${item.question.header ?? item.field.name}.`;
        } else if (parsed === skippedAnswer) {
          delete content[item.field.name];
        } else {
          content[item.field.name] = parsed;
        }
      }
    }

    if (parseError !== undefined) {
      validationError = parseError;
      continue;
    }
    const validation = validate(content);
    if (validation.valid) {
      return { action: 'accept', content: validation.data };
    }
    validationError = validation.errorMessage;
  }
}

export async function requestMcpUrlElicitation(
  serverName: string,
  params: ElicitRequestURLParams,
  requestId: string | number,
  signal: AbortSignal,
  rpc: SDKSessionRPC,
): Promise<ElicitResult> {
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    return { action: 'decline' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { action: 'decline' };
  }

  const question = `Open URL requested by MCP server "${serverName}"`;
  const result = await rpc.requestQuestion(
    {
      agentId: 'main',
      toolCallId: `mcp-url-elicitation:${serverName}:${String(requestId)}`,
      questions: [
        {
          question,
          header: OPEN_URL_LABEL,
          body: [
            params.message,
            'Only continue if you trust this server and understand why it needs this URL.',
            `Domain: ${parsed.hostname}`,
            `URL: ${params.url}`,
          ].join('\n\n'),
          options: [
            {
              label: OPEN_URL_LABEL,
              description: parsed.hostname,
              url: params.url,
            },
            { label: DECLINE_LABEL },
          ],
          allowOther: false,
        },
      ],
    },
    { signal },
  );
  const answers = questionAnswers(result);
  if (answers === null) return { action: 'cancel' };
  const answer = answers[question] ?? answers['q_0'];
  if (answer === DECLINE_LABEL) return { action: 'decline' };
  if (answer !== OPEN_URL_LABEL) return { action: 'cancel' };

  await rpc.emitEvent({
    agentId: 'main',
    type: 'hook.status',
    statusId: mcpUrlStatusId(serverName, params.elicitationId),
    hookEvent: 'Elicitation',
    content: `Waiting for MCP server "${serverName}" to confirm URL completion: ${params.url}`,
    active: true,
  });
  return { action: 'accept' };
}

export function mcpUrlStatusId(serverName: string, elicitationId: string): string {
  return `mcp-url:${serverName}:${elicitationId}`;
}

export function parseNaturalDateTime(
  input: string,
  format: 'date' | 'date-time',
  now = new Date(),
): string | undefined {
  const value = input.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
  if (value.length === 0) return undefined;
  const date = new Date(now);
  date.setMilliseconds(0);

  const relative = /^in (\d+) (minute|hour|day|week)s?$/u.exec(value);
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit === 'minute') date.setMinutes(date.getMinutes() + amount);
    if (unit === 'hour') date.setHours(date.getHours() + amount);
    if (unit === 'day') date.setDate(date.getDate() + amount);
    if (unit === 'week') date.setDate(date.getDate() + amount * 7);
    return formatNaturalDate(date, format);
  }

  const phrase = /^(today|tomorrow|yesterday|next ([a-z]+))(?: at (.+))?$/u.exec(value);
  if (phrase !== null) {
    const day = phrase[1]!;
    if (day === 'tomorrow') date.setDate(date.getDate() + 1);
    if (day === 'yesterday') date.setDate(date.getDate() - 1);
    if (day.startsWith('next ')) {
      const weekday = WEEKDAYS.indexOf(phrase[2] as (typeof WEEKDAYS)[number]);
      if (weekday < 0) return undefined;
      const daysAhead = (weekday - date.getDay() + 7) % 7 || 7;
      date.setDate(date.getDate() + daysAhead);
    }
    if (phrase[3] !== undefined && !setNaturalTime(date, phrase[3])) {
      return undefined;
    }
    return formatNaturalDate(date, format);
  }

  if (format === 'date-time' && setNaturalTime(date, value.replace(/^at /u, ''))) {
    return formatNaturalDate(date, format);
  }
  return undefined;
}

function buildFieldQuestion(
  field: FormField,
  message: string,
  validationError: string | undefined,
): FieldQuestion {
  const title = field.schema.title ?? field.name;
  const body = [
    message,
    validationError === undefined ? undefined : `Previous response: ${validationError}`,
    field.schema.description,
    field.required ? 'Required.' : 'Optional.',
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n\n');

  const values = enumValues(field.schema);
  if (values !== undefined) {
    const optionValues: Array<string | undefined> = [
      ...(field.required ? [] : [undefined]),
      ...values.map((entry) => entry.value),
    ];
    return {
      field,
      question: {
        question: `${title} (${field.name})`,
        header: title,
        body,
        options: [
          ...(field.required ? [] : [{ label: SKIP_LABEL }]),
          ...values.map((entry, index) => ({
            label: `${String(index + 1)}. ${entry.title.replaceAll(',', ';')}`,
            description: entry.title === entry.value ? undefined : entry.value,
          })),
        ],
        multiSelect: field.schema.type === 'array',
        allowOther: false,
      },
      optionValues,
    };
  }

  if (field.schema.type === 'boolean') {
    return {
      field,
      question: {
        question: `${title} (${field.name})`,
        header: title,
        body,
        options: [
          ...(field.required ? [] : [{ label: SKIP_LABEL }]),
          { label: 'Yes' },
          { label: 'No' },
        ],
        allowOther: false,
      },
      optionValues: [...(field.required ? [] : [undefined]), true, false],
    };
  }

  return {
    field,
    question: {
      question: `${title} (${field.name})`,
      header: title,
      body,
      options: field.required ? [] : [{ label: SKIP_LABEL }],
      allowOther: true,
      otherLabel: `Enter ${title}`,
    },
    optionValues: field.required ? [] : [undefined],
  };
}

function enumValues(
  schema: PrimitiveSchemaDefinition,
): Array<{ readonly value: string; readonly title: string }> | undefined {
  if (schema.type === 'array') {
    if ('enum' in schema.items) {
      return schema.items.enum.map((value) => ({ value, title: value }));
    }
    return schema.items.anyOf.map((entry) => ({ value: entry.const, title: entry.title }));
  }
  if (schema.type !== 'string') return undefined;
  if ('oneOf' in schema) {
    return schema.oneOf.map((entry) => ({ value: entry.const, title: entry.title }));
  }
  if ('enum' in schema) {
    return schema.enum.map((value, index) => ({
      value,
      title: ('enumNames' in schema ? schema.enumNames?.[index] : undefined) ?? value,
    }));
  }
  return undefined;
}

function questionAnswers(result: QuestionResult): QuestionAnswers | null {
  if (result === null) return null;
  const response = result as { readonly answers?: unknown };
  return typeof response.answers === 'object' && response.answers !== null
    ? (response.answers as QuestionAnswers)
    : (result as QuestionAnswers);
}

function parseFieldAnswer(
  item: FieldQuestion,
  raw: string | true,
  questionIndex: number,
):
  | string
  | number
  | boolean
  | string[]
  | typeof invalidAnswer
  | typeof skippedAnswer {
  if (raw === true) return item.field.schema.type === 'boolean' ? true : invalidAnswer;
  if (raw === SKIP_LABEL) return skippedAnswer;

  const optionIndexes = selectedOptionIndexes(raw, item, questionIndex);
  if (optionIndexes !== undefined) {
    const values = optionIndexes.map((index) => item.optionValues[index]);
    if (values.some((value) => value === undefined)) return skippedAnswer;
    return item.field.schema.type === 'array'
      ? (values as string[])
      : (values[0] ?? invalidAnswer);
  }

  if (item.field.schema.type === 'string') {
    const format = 'format' in item.field.schema ? item.field.schema.format : undefined;
    if (format === 'date' || format === 'date-time') {
      return parseNaturalDateTime(raw, format) ?? raw;
    }
    return raw;
  }
  if (
    item.field.schema.type === 'number' ||
    item.field.schema.type === 'integer'
  ) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : invalidAnswer;
  }
  return invalidAnswer;
}

function selectedOptionIndexes(
  raw: string,
  item: FieldQuestion,
  questionIndex: number,
): number[] | undefined {
  const idPrefix = `opt_${String(questionIndex)}_`;
  if (raw.startsWith(idPrefix)) {
    const indexes = raw
      .split(',')
      .map((id) => Number.parseInt(id.slice(idPrefix.length), 10));
    return indexes.every((index) => Number.isInteger(index)) ? indexes : undefined;
  }

  const labels = item.question.options.map((option) => option.label);
  if (labels.includes(raw)) return [labels.indexOf(raw)];
  const parts = raw.split(', ');
  const indexes = parts.map((part) => labels.indexOf(part));
  return indexes.every((index) => index >= 0) ? indexes : undefined;
}

function setNaturalTime(date: Date, input: string): boolean {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/u.exec(input);
  if (match === null) return false;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3];
  if (
    minute > 59 ||
    hour > (meridiem === undefined ? 23 : 12) ||
    (hour === 0 && meridiem !== undefined)
  ) {
    return false;
  }
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  date.setHours(hour, minute, 0, 0);
  return true;
}

function formatNaturalDate(date: Date, format: 'date' | 'date-time'): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const datePart = `${year}-${month}-${day}`;
  if (format === 'date') return datePart;

  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHour = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetMinute = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  return `${datePart}T${hour}:${minute}:${second}${sign}${offsetHour}:${offsetMinute}`;
}
