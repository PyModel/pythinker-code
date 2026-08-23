import type {
  AgentDescriptor,
  AgentTranscriptSnapshot,
  TranscriptAttachment,
  TranscriptTask,
  TranscriptTurn,
} from '@pymodel/transcript';
import type { AppMessage, AppMessageContent, ImageSource } from '../api/types';
import type { ChatTurn, TaskNotification } from '../types';
import { messagesToTurns } from '../composables/messagesToTurns';
import { parseTaskNotifications, TASK_NOTIFICATION_METADATA_KEY } from './taskNotification';

export interface TranscriptTurnOptions {
  sessionId: string;
  getFileUrl(fileId: string): string;
}

export function transcriptSnapshotToTurns(
  snapshot: AgentTranscriptSnapshot,
  agent: AgentDescriptor | undefined,
  options: TranscriptTurnOptions,
): ChatTurn[] {
  const attachments = new Map(
    snapshot.attachments.map((attachment) => [attachment.attachmentId, attachment]),
  );
  const tasks = new Map(snapshot.tasks.map((task) => [task.taskId, task]));
  const firstTurn = snapshot.items.find((item) => item.kind === 'turn');
  const lastTurn = snapshot.items.findLast((item) => item.kind === 'turn');
  const messages = snapshot.items.flatMap((item) =>
    item.kind === 'turn'
      ? transcriptTurnToMessages(item, attachments, tasks, {
          ...options,
          startedAt: item.turnId === firstTurn?.turnId ? agent?.createdAt : undefined,
          endedAt: item.turnId === lastTurn?.turnId ? agent?.disposedAt : undefined,
        })
      : [],
  );
  return messagesToTurns(
    messages,
    [],
    (fileId) => options.getFileUrl(fileId),
    snapshot.meta.activity === 'turn',
  );
}

function transcriptTurnToMessages(
  turn: TranscriptTurn,
  attachments: Map<string, TranscriptAttachment>,
  tasks: Map<string, TranscriptTask>,
  options: TranscriptTurnOptions & { startedAt?: string; endedAt?: string },
): AppMessage[] {
  const messages: AppMessage[] = [];
  const createdAt = earliestDate([
    turn.startedAt,
    ...turn.steps.map((step) => step.startedAt),
    options.startedAt,
  ]);
  const endedAt = validDate(turn.endedAt) ?? validDate(options.endedAt);
  const promptId = turn.turnId;

  if (turn.prompt !== undefined && turn.prompt.length > 0) {
    const content: AppMessageContent[] = [{ type: 'text', text: turn.prompt }];
    for (const id of turn.attachmentIds ?? []) {
      const part = attachmentContent(attachments.get(id));
      if (part !== undefined) content.push(part);
    }
    messages.push({
      id: `${turn.turnId}:input`,
      sessionId: options.sessionId,
      role: 'user',
      content,
      createdAt,
      promptId,
      metadata: { origin: turn.origin },
    });
  }

  for (const step of turn.steps) {
    const stepTime = validDate(step.startedAt) ?? createdAt;
    for (const frame of step.frames) {
      if (frame.kind === 'text') {
        if (frame.text.length === 0) continue;
        if (frame.role === 'user' && frame.taskId === undefined) continue;
        messages.push({
          id: frame.frameId,
          sessionId: options.sessionId,
          role: frame.role,
          content: [{ type: 'text', text: frame.text }],
          createdAt: stepTime,
          promptId,
          metadata:
            frame.taskId === undefined
              ? undefined
              : {
                  origin: { kind: 'task', taskId: frame.taskId },
                  task: tasks.get(frame.taskId),
                  [TASK_NOTIFICATION_METADATA_KEY]: taskNotificationFromFrame(
                    frame.taskId,
                    frame.text,
                    tasks.get(frame.taskId),
                  ),
                },
        });
        continue;
      }
      if (frame.kind === 'thinking') {
        if (frame.text.length === 0) continue;
        messages.push({
          id: frame.frameId,
          sessionId: options.sessionId,
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: frame.text,
              // Frames carry no timing of their own; borrow the step's. A
              // finished step settles the thinking (durationMs), a still-
              // running step leaves it open so the live tail can stream.
              startedAt: stepTime,
              durationMs: durationBetween(stepTime, validDate(step.endedAt)),
            },
          ],
          createdAt: stepTime,
          promptId,
        });
        continue;
      }
      if (frame.kind !== 'tool') continue;
      messages.push({
        id: `${frame.frameId}:call`,
        sessionId: options.sessionId,
        role: 'assistant',
        content: [
          {
            type: 'toolUse',
            toolCallId: frame.toolCallId,
            toolName: frame.name,
            input: frame.input ?? frame.display ?? {},
            outputLines:
              frame.state === 'running' ? normalizeOutput(frame.output) : undefined,
          },
        ],
        createdAt: stepTime,
        promptId,
      });
      if (frame.state !== 'running') {
        messages.push({
          id: `${frame.frameId}:result`,
          sessionId: options.sessionId,
          role: 'tool',
          content: [
            {
              type: 'toolResult',
              toolCallId: frame.toolCallId,
              output: frame.output ?? frame.error ?? '',
              isError: frame.state === 'error',
            },
          ],
          createdAt: validDate(step.endedAt) ?? stepTime,
          promptId,
        });
      }
    }
  }

  const durationMs = turn.durationMs ?? durationBetween(createdAt, endedAt);
  if (durationMs !== undefined) {
    const index = messages.findLastIndex((message) => message.role === 'assistant');
    if (index >= 0) messages[index] = { ...messages[index]!, durationMs };
  }
  return messages;
}

function taskNotificationFromFrame(
  taskId: string,
  text: string,
  task: TranscriptTask | undefined,
): TaskNotification {
  const parsed = parseTaskNotifications(text)[0];
  if (parsed !== undefined) return parsed;
  const [title = '', ...body] = text.split('\n');
  const state = task?.state ?? 'info';
  return {
    id: `task:${taskId}:${state}`,
    category: 'task',
    type: `task.${state}`,
    sourceKind: task?.kind === 'subagent' ? 'subagent' : 'background_task',
    sourceId: taskId,
    agentId: task?.agentId,
    title: title.trim(),
    severity: state === 'completed' ? 'info' : 'warning',
    body: body.join('\n').trim(),
    raw: text,
  };
}

function attachmentContent(
  attachment: TranscriptAttachment | undefined,
): AppMessageContent | undefined {
  if (attachment?.source === undefined) return undefined;
  const source: ImageSource =
    attachment.source.kind === 'url'
      ? { kind: 'url', url: attachment.source.url }
      : { kind: 'file', fileId: attachment.source.fileId };
  if (attachment.mediaType.startsWith('image/')) return { type: 'image', source };
  if (attachment.mediaType.startsWith('video/')) return { type: 'video', source };
  if (attachment.source.kind === 'file') {
    return {
      type: 'file',
      fileId: attachment.source.fileId,
      name: attachment.name ?? attachment.attachmentId,
      mediaType: attachment.mediaType,
      size: attachment.size ?? 0,
    };
  }
  return undefined;
}

function normalizeOutput(output: unknown): string[] | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === 'string') return output.split('\n');
  if (!Array.isArray(output)) return [JSON.stringify(output)];
  const lines: string[] = [];
  for (const part of output) {
    if (typeof part === 'string') {
      lines.push(...part.split('\n'));
      continue;
    }
    if (part === null || typeof part !== 'object') continue;
    const value = part as Record<string, unknown>;
    if (value['type'] === 'text' && typeof value['text'] === 'string') {
      lines.push(...value['text'].split('\n'));
    } else if (value['type'] === 'think' && typeof value['think'] === 'string') {
      lines.push(...value['think'].split('\n'));
    }
  }
  return lines.length > 0 ? lines : undefined;
}

function validDate(value: string | undefined): string | undefined {
  return value !== undefined && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function earliestDate(values: Array<string | undefined>): string {
  let earliest: { value: string; time: number } | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) continue;
    if (earliest === undefined || time < earliest.time) earliest = { value, time };
  }
  return earliest?.value ?? '';
}

function durationBetween(start: string, end: string | undefined): number | undefined {
  if (start.length === 0 || end === undefined) return undefined;
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}
