import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { truncateToWidth } from '@earendil-works/pi-tui';

import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/choice-picker';
import type { TranscriptEntry } from '../types';
import { formatErrorMessage } from '../utils/event-payload';
import { applyCopyPreferenceChoice } from './config';
import type { SlashCommandHost } from './dispatch';

const COPY_DIR = join(tmpdir(), 'pythinker');
const MAX_LOOKBACK = 20;
const MESSAGE_ACTION_KINDS = new Set<TranscriptEntry['kind']>([
  'user',
  'assistant',
  'tool_call',
  'status',
  'cron',
  'goal',
]);

export interface FencedCodeBlock {
  readonly code: string;
  readonly language?: string;
}

export interface MessageActionChoice extends ChoiceOption {
  readonly entry: TranscriptEntry;
}

export function buildMessageActionChoices(
  entries: readonly TranscriptEntry[],
): MessageActionChoice[] {
  const choices: MessageActionChoice[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined || !MESSAGE_ACTION_KINDS.has(entry.kind)) continue;
    const text = messageActionText(entry);
    if (text.length === 0) continue;
    choices.push({
      value: entry.id,
      label: messageActionLabel(entry),
      description: text.replaceAll(/\s+/gu, ' ').trim(),
      entry,
    });
  }
  return choices;
}

export function showMessageActions(host: SlashCommandHost): void {
  const choices = buildMessageActionChoices(host.state.transcriptEntries);
  if (choices.length === 0) {
    host.showError('No transcript message to select.');
    return;
  }

  const findChoice = (value: string): MessageActionChoice | undefined =>
    choices.find((choice) => choice.value === value);
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Message actions',
      options: choices,
      pageSize: 8,
      keybindingContext: 'MessageActions',
      isUserOption: (choice) => findChoice(choice.value)?.entry.kind === 'user',
      onCopy: (value) => {
        const choice = findChoice(value);
        if (choice !== undefined) void copyMessageAction(host, choice.entry);
      },
      onPrimaryInput: (value) => {
        const choice = findChoice(value);
        if (choice?.entry.kind === 'tool_call') {
          void copyMessageAction(host, choice.entry, messageActionText(choice.entry));
        }
      },
      onSelect: (value) => {
        const choice = findChoice(value);
        if (choice === undefined) return;
        if (choice.entry.kind === 'user') {
          host.restoreInputText(choice.entry.content);
          return;
        }
        void copyMessageAction(host, choice.entry);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export function collectRecentAssistantTexts(
  entries: readonly TranscriptEntry[],
): string[] {
  const texts: string[] = [];
  for (let index = entries.length - 1; index >= 0 && texts.length < MAX_LOOKBACK; index--) {
    const entry = entries[index];
    if (entry?.kind === 'assistant' && entry.content.trim().length > 0) {
      texts.push(entry.content);
    }
  }
  return texts;
}

export function extractFencedCodeBlocks(markdown: string): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  const pattern =
    /(?:^|\r?\n)[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)(?:\r?\n[ \t]{0,3}\1[ \t]*(?=\r?\n|$))/gu;

  for (const match of markdown.matchAll(pattern)) {
    const rawLanguage = match[2]?.trim().split(/\s+/u)[0] ?? '';
    const language = rawLanguage.replaceAll(/[^a-zA-Z0-9]/gu, '');
    blocks.push({
      code: match[3] ?? '',
      language: language.length > 0 && language !== 'plaintext' ? language : undefined,
    });
  }
  return blocks;
}

export async function handleCopyCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const texts = collectRecentAssistantTexts(host.state.transcriptEntries);
  if (texts.length === 0) {
    host.showError('No assistant message to copy.');
    return;
  }

  const requested = parseMessageNumber(host, args, texts.length);
  if (requested === undefined) return;

  const text = texts[requested - 1]!;
  const blocks = extractFencedCodeBlocks(text);
  if (blocks.length === 0 || host.state.copyFullResponse) {
    await copyAndWrite(host, text, 'response.md', requested, blocks.length);
    return;
  }

  const options: ChoiceOption[] = [
    {
      value: 'full',
      label: 'Full response',
      description: describeText(text),
    },
    ...blocks.map((block, index) => ({
      value: `block:${String(index)}`,
      label: truncateToWidth(block.code.split(/\r?\n/u)[0] ?? '', 60, '…'),
      description: [block.language, describeLineCount(block.code)].filter(Boolean).join(' · '),
    })),
    {
      value: 'always',
      label: 'Always copy full responses',
      description: 'Save this preference and skip this picker next time.',
    },
  ];

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Copy response',
      options,
      secondaryAction: {
        key: 'w',
        label: 'write to file',
        onSelect: (value) => {
          host.restoreEditor();
          void writeSelection(host, value, text, blocks);
        },
      },
      onSelect: (value) => {
        host.restoreEditor();
        void copySelection(host, value, text, blocks, requested);
      },
      onCancel: () => {
        host.restoreEditor();
        host.showStatus('Copy cancelled.');
      },
    }),
  );
}

function parseMessageNumber(
  host: SlashCommandHost,
  args: string,
  available: number,
): number | undefined {
  const value = args.trim();
  if (value.length === 0) return 1;

  const requested = Number(value);
  if (!Number.isInteger(requested) || requested < 1) {
    host.showError(`Usage: /copy [N] where N is 1 (latest), 2, 3, … Got: ${value}`);
    return undefined;
  }
  if (requested > available) {
    host.showError(
      `Only ${String(available)} assistant ${available === 1 ? 'message' : 'messages'} available to copy.`,
    );
    return undefined;
  }
  return requested;
}

async function copySelection(
  host: SlashCommandHost,
  value: string,
  fullText: string,
  blocks: readonly FencedCodeBlock[],
  requested: number,
): Promise<void> {
  if (value === 'always') {
    await applyCopyPreferenceChoice(host, true);
  }
  const selection = selectionContent(value, fullText, blocks);
  await copyAndWrite(host, selection.text, selection.filename, requested, blocks.length);
}

async function writeSelection(
  host: SlashCommandHost,
  value: string,
  fullText: string,
  blocks: readonly FencedCodeBlock[],
): Promise<void> {
  const selection = selectionContent(value, fullText, blocks);
  try {
    const path = await writeCopyFile(selection.text, selection.filename);
    host.showStatus(`Written to ${path}`, 'success');
  } catch (error) {
    host.showError(`Failed to write response: ${formatErrorMessage(error)}`);
  }
}

function selectionContent(
  value: string,
  fullText: string,
  blocks: readonly FencedCodeBlock[],
): { readonly text: string; readonly filename: string } {
  if (!value.startsWith('block:')) {
    return { text: fullText, filename: 'response.md' };
  }
  const block = blocks[Number(value.slice('block:'.length))]!;
  return {
    text: block.code,
    filename: `copy.${block.language ?? 'txt'}`,
  };
}

async function copyAndWrite(
  host: SlashCommandHost,
  text: string,
  filename: string,
  requested: number,
  blockCount: number,
): Promise<void> {
  let clipboardError: unknown;
  try {
    await copyTextToClipboard(text);
  } catch (error) {
    clipboardError = error;
  }

  let path: string | undefined;
  try {
    path = await writeCopyFile(text, filename);
  } catch (error) {
    if (clipboardError !== undefined) {
      host.showError(
        `Copy failed: ${formatErrorMessage(clipboardError)}; fallback file failed: ${formatErrorMessage(error)}`,
      );
      return;
    }
  }

  host.track('copy_response', {
    message_age: requested - 1,
    block_count: blockCount,
    clipboard: clipboardError === undefined,
  });
  const summary = `${String(text.length)} characters, ${describeLineCount(text)}`;
  if (clipboardError === undefined) {
    host.showStatus(
      `Copied to clipboard (${summary})${path === undefined ? '' : `\nAlso written to ${path}`}`,
      'success',
    );
  } else {
    host.showStatus(
      `Clipboard unavailable; written to ${path}\n${formatErrorMessage(clipboardError)}`,
      'warning',
    );
  }
}

async function writeCopyFile(text: string, filename: string): Promise<string> {
  const path = join(COPY_DIR, filename);
  await mkdir(COPY_DIR, { recursive: true });
  await writeFile(path, text, 'utf8');
  return path;
}

function describeText(text: string): string {
  return `${String(text.length)} characters · ${describeLineCount(text)}`;
}

function describeLineCount(text: string): string {
  const lines = text.split(/\r?\n/u).length;
  return `${String(lines)} ${lines === 1 ? 'line' : 'lines'}`;
}

async function copyMessageAction(
  host: SlashCommandHost,
  entry: TranscriptEntry,
  text = entry.content.trim(),
): Promise<void> {
  host.restoreEditor();
  try {
    await copyTextToClipboard(text);
    host.showStatus(`Copied ${messageActionLabel(entry).toLowerCase()} message.`, 'success');
  } catch (error) {
    host.showError(`Copy failed: ${formatErrorMessage(error)}`);
  }
}

function messageActionLabel(entry: TranscriptEntry): string {
  if (entry.kind === 'tool_call') return entry.toolCallData?.name ?? 'Tool';
  return entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1);
}

function messageActionText(entry: TranscriptEntry): string {
  if (entry.kind !== 'tool_call') return entry.content.trim();
  const data = entry.toolCallData;
  if (data === undefined) return entry.content.trim();
  const display = data.display;
  if (display !== undefined) {
    switch (display.kind) {
      case 'command':
        return display.command;
      case 'file_io':
      case 'diff':
        return display.path;
      case 'search':
        return display.query;
      case 'url_fetch':
        return display.url;
      case 'agent_call':
        return display.prompt;
      case 'skill_call':
        return display.args ?? display.skill_name;
      case 'background_task':
      case 'task_stop':
        return display.task_id;
      case 'plan_review':
        return display.plan;
      case 'todo_list':
        break;
      case 'generic':
        return display.summary;
    }
  }
  for (const key of [
    'command',
    'file_path',
    'notebook_path',
    'path',
    'pattern',
    'url',
    'query',
    'prompt',
  ]) {
    const value = data.args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return entry.content.trim();
}
