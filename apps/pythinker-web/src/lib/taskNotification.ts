import type { TaskNotification } from '../types';

export const TASK_NOTIFICATION_METADATA_KEY = 'pythinkerWeb.taskNotification';

const NOTIFICATION_RE = /<notification\b([^>]*)>([\s\S]*?)<\/notification>/g;
const ATTRIBUTE_RE = /([\w-]+)="([^"]*)"/g;
const OUTPUT_FILE_RE = /<output-file\b([^>]*)>[\s\S]*?<\/output-file>/;
const OUTPUT_PREVIEW_RE = /<output-preview\b([^>]*)>([\s\S]*?)<\/output-preview>/;
const TITLE_RE = /^Title: (.*)$/m;
const SEVERITY_RE = /^Severity: (.*)$/m;

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(ATTRIBUTE_RE)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      result[match[1]] = decodeXml(match[2]);
    }
  }
  return result;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseTaskNotification(
  rawAttributes: string,
  content: string,
  raw: string,
): TaskNotification {
  const attrs = attributes(rawAttributes);
  const title = TITLE_RE.exec(content)?.[1]?.trim() ?? '';
  const severity = SEVERITY_RE.exec(content)?.[1]?.trim() ?? '';
  let body = content
    .split('\n')
    .filter((line) => !line.startsWith('Title: ') && !line.startsWith('Severity: '))
    .join('\n');
  const childStart = body.search(/^<\w/m);
  if (childStart !== -1) body = body.slice(0, childStart);

  const outputFileMatch = OUTPUT_FILE_RE.exec(content);
  const outputFileAttrs = outputFileMatch ? attributes(outputFileMatch[1] ?? '') : undefined;
  const outputFile =
    outputFileAttrs?.['path']
      ? { path: outputFileAttrs['path'], bytes: finiteNumber(outputFileAttrs['bytes']) }
      : undefined;

  const outputPreviewMatch = OUTPUT_PREVIEW_RE.exec(content);
  const outputPreviewAttrs = outputPreviewMatch
    ? attributes(outputPreviewMatch[1] ?? '')
    : undefined;
  const outputPreviewBody = (outputPreviewMatch?.[2] ?? '').replace(/^\n/, '');
  const previewHeaderEnd = outputPreviewBody.indexOf('\n');
  const outputPreview = outputPreviewMatch
    ? {
        text: decodeXml(
          previewHeaderEnd === -1 ? '' : outputPreviewBody.slice(previewHeaderEnd + 1),
        ).replace(/\n$/, ''),
        bytes: finiteNumber(outputPreviewAttrs?.['bytes']),
        totalBytes: finiteNumber(outputPreviewAttrs?.['total_bytes']),
        truncated:
          outputPreviewAttrs?.['truncated'] === 'true'
            ? true
            : outputPreviewAttrs?.['truncated'] === 'false'
              ? false
              : undefined,
      }
    : undefined;

  return {
    id: attrs['id'] ?? '',
    category: attrs['category'] ?? '',
    type: attrs['type'] ?? '',
    sourceKind: attrs['source_kind'] ?? '',
    sourceId: attrs['source_id'] ?? '',
    agentId: attrs['agent_id'],
    title: decodeXml(title),
    severity,
    body: decodeXml(body.trim()),
    outputFile,
    outputPreview,
    raw,
  };
}

export function parseTaskNotifications(text: string): TaskNotification[] {
  if (!text.includes('<notification')) return [];
  const notifications: TaskNotification[] = [];
  for (const match of text.matchAll(NOTIFICATION_RE)) {
    if (match[1] === undefined || match[2] === undefined) continue;
    notifications.push(parseTaskNotification(match[1], match[2], match[0]));
  }
  return notifications;
}

export function taskNotificationFromMetadata(
  metadata: Record<string, unknown> | undefined,
): TaskNotification | undefined {
  const value = metadata?.[TASK_NOTIFICATION_METADATA_KEY];
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;

  const id = candidate['id'];
  const category = candidate['category'];
  const type = candidate['type'];
  const sourceKind = candidate['sourceKind'];
  const sourceId = candidate['sourceId'];
  const agentId = candidate['agentId'];
  const title = candidate['title'];
  const severity = candidate['severity'];
  const body = candidate['body'];
  const raw = candidate['raw'];
  const createdAt = candidate['createdAt'];
  if (
    typeof id !== 'string' ||
    typeof category !== 'string' ||
    typeof type !== 'string' ||
    typeof sourceKind !== 'string' ||
    typeof sourceId !== 'string' ||
    typeof title !== 'string' ||
    typeof severity !== 'string' ||
    typeof body !== 'string' ||
    typeof raw !== 'string' ||
    (agentId !== undefined && typeof agentId !== 'string') ||
    (createdAt !== undefined && typeof createdAt !== 'string')
  ) {
    return undefined;
  }

  let outputFile: TaskNotification['outputFile'];
  const outputFileValue = candidate['outputFile'];
  if (outputFileValue !== undefined) {
    if (
      typeof outputFileValue !== 'object' ||
      outputFileValue === null ||
      Array.isArray(outputFileValue)
    ) {
      return undefined;
    }
    const file = outputFileValue as Record<string, unknown>;
    const path = file['path'];
    const bytes = file['bytes'];
    if (
      typeof path !== 'string' ||
      (bytes !== undefined && (typeof bytes !== 'number' || !Number.isFinite(bytes)))
    ) {
      return undefined;
    }
    outputFile = { path, bytes };
  }

  let outputPreview: TaskNotification['outputPreview'];
  const outputPreviewValue = candidate['outputPreview'];
  if (outputPreviewValue !== undefined) {
    if (
      typeof outputPreviewValue !== 'object' ||
      outputPreviewValue === null ||
      Array.isArray(outputPreviewValue)
    ) {
      return undefined;
    }
    const preview = outputPreviewValue as Record<string, unknown>;
    const text = preview['text'];
    const bytes = preview['bytes'];
    const totalBytes = preview['totalBytes'];
    const truncated = preview['truncated'];
    if (
      typeof text !== 'string' ||
      (bytes !== undefined && (typeof bytes !== 'number' || !Number.isFinite(bytes))) ||
      (totalBytes !== undefined &&
        (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes))) ||
      (truncated !== undefined && typeof truncated !== 'boolean')
    ) {
      return undefined;
    }
    outputPreview = { text, bytes, totalBytes, truncated };
  }

  return {
    id,
    category,
    type,
    sourceKind,
    sourceId,
    agentId,
    title,
    severity,
    body,
    outputFile,
    outputPreview,
    raw,
    createdAt,
  };
}

export type TaskNotificationState =
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'killed'
  | 'lost'
  | 'info';

export function taskNotificationState(notification: TaskNotification): TaskNotificationState {
  for (const state of ['completed', 'failed', 'timed_out', 'killed', 'lost'] as const) {
    if (notification.type.endsWith(`.${state}`)) return state;
  }
  return 'info';
}

export function taskNotificationTone(
  notification: TaskNotification,
): 'ok' | 'err' | 'warn' | 'info' {
  const state = taskNotificationState(notification);
  if (state === 'completed') return 'ok';
  if (state === 'failed' || state === 'timed_out' || state === 'lost') return 'err';
  if (state === 'killed') return 'warn';
  if (notification.severity === 'error') return 'err';
  if (notification.severity === 'warning') return 'warn';
  return 'info';
}
