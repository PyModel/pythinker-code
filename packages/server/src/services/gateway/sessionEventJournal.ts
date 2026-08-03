/**
 * `SessionEventJournal` — per-session durable event log.
 *
 * One JSONL file per session under `<pythinkerHome>/server/events-v3/`.
 * Existing journals are validated before use. A missing file starts a new
 * epoch; every other open or append failure is permanent for that journal.
 */

import { isUtf8 } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, truncate } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ulid } from 'ulid';

import { WS_PROTOCOL_VERSION, sessionEventMessageSchema } from '@pythoughts/protocol';
import type { ILogService } from '@pythoughts/agent-core';

import type { EventEnvelope } from '#/ws/protocol';

const JOURNAL_VERSION = WS_PROTOCOL_VERSION;

interface JournalHeaderLine {
  kind: 'journal_header';
  version: number;
  epoch: string;
  created_at: number;
}

interface JournalEventLine {
  kind: 'event';
  seq: number;
  envelope: EventEnvelope;
}

interface JournalRawLine {
  raw: string;
  byteOffset: number;
  terminated: boolean;
  incompleteUtf8: boolean;
}

export interface JournalEntry {
  seq: number;
  envelope: EventEnvelope;
}

export class SessionEventJournal {
  private failure: Error | undefined;
  private headerPending: boolean;

  private constructor(
    private readonly filePath: string,
    public readonly epoch: string,
    private _seq: number,
    isFresh: boolean,
  ) {
    this.headerPending = isFresh;
  }

  /** Highest durable seq appended (0 if none). */
  get seq(): number {
    this.throwIfFailed();
    return this._seq;
  }

  /** Open or create a journal. Only a missing file starts a fresh epoch. */
  static async open(filePath: string, _logger: ILogService): Promise<SessionEventJournal> {
    void _logger;
    const lines: JournalRawLine[] = [];
    try {
      for await (const line of readLines(filePath)) lines.push(line);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new SessionEventJournal(filePath, `ep_${ulid()}`, 0, true);
      }
      throw error;
    }

    if (lines.length === 0) {
      throw new Error(`event journal is empty: ${filePath}`);
    }

    let epoch: string | undefined;
    let lastSeq = 0;
    let tornTailOffset: number | undefined;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (line.incompleteUtf8) {
        if (!line.terminated && isIncompleteJson(line.raw)) {
          tornTailOffset = line.byteOffset;
          break;
        }
        throw new Error(`invalid UTF-8 event journal line ${index + 1}: ${filePath}`);
      }
      const value = parseJson(line.raw);
      if (value === undefined) {
        if (!line.terminated && isIncompleteJson(line.raw)) {
          tornTailOffset = line.byteOffset;
          break;
        }
        throw new Error(`invalid event journal line ${index + 1}: ${filePath}`);
      }

      if (index === 0) {
        const header = parseHeader(value);
        if (header === undefined || header.version !== JOURNAL_VERSION) {
          throw new Error(`invalid event journal header: ${filePath}`);
        }
        epoch = header.epoch;
        continue;
      }

      const event = parseEvent(value);
      if (event === undefined) {
        throw new Error(`invalid event journal record ${index + 1}: ${filePath}`);
      }
      if (
        epoch === undefined ||
        event.seq !== lastSeq + 1 ||
        event.envelope.seq !== event.seq ||
        event.envelope.epoch !== epoch ||
        event.envelope.volatile === true ||
        event.envelope.session_id.length === 0 ||
        !sessionEventMessageSchema.safeParse(event.envelope).success
      ) {
        throw new Error(`invalid event journal event ${index + 1}: ${filePath}`);
      }
      lastSeq = event.seq;
    }

    if (epoch === undefined) {
      throw new Error(`event journal is missing a header: ${filePath}`);
    }
    if (tornTailOffset !== undefined) {
      await truncate(filePath, tornTailOffset);
    }
    return new SessionEventJournal(filePath, epoch, lastSeq, false);
  }

  /** Returns the next seq without mutating journal state. */
  nextSeq(): number {
    this.throwIfFailed();
    return this._seq + 1;
  }

  /** Persist an event before advancing the in-memory durable watermark. */
  async append(seq: number, envelope: EventEnvelope): Promise<void> {
    this.throwIfFailed();
    if (seq !== this._seq + 1) {
      throw this.poison(new Error(`non-contiguous event journal append: ${this.filePath}`));
    }

    const lines: string[] = [];
    if (this.headerPending) {
      lines.push(JSON.stringify({
        kind: 'journal_header',
        version: JOURNAL_VERSION,
        epoch: this.epoch,
        created_at: Date.now(),
      } satisfies JournalHeaderLine));
    }
    lines.push(JSON.stringify({ kind: 'event', seq, envelope } satisfies JournalEventLine));

    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, lines.join('\n') + '\n', 'utf8');
    } catch (error) {
      throw this.poison(error);
    }

    this.headerPending = false;
    this._seq = seq;
  }

  /** Read journal entries with `seq > fromSeqExclusive`, capped at `limit`. */
  async readSince(fromSeqExclusive: number, limit: number): Promise<JournalEntry[]> {
    this.throwIfFailed();
    if (this._seq === 0) return [];

    const out: JournalEntry[] = [];
    try {
      for await (const line of readLines(this.filePath)) {
        const event = parseEvent(parseJson(line.raw));
        if (event === undefined || event.seq <= fromSeqExclusive) continue;
        out.push({ seq: event.seq, envelope: event.envelope });
        if (out.length >= limit) break;
      }
    } catch (error) {
      throw this.poison(error);
    }
    return out;
  }

  async flush(): Promise<void> {
    this.throwIfFailed();
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private throwIfFailed(): void {
    if (this.failure !== undefined) throw this.failure;
  }

  private poison(error: unknown): Error {
    if (this.failure === undefined) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
    return this.failure;
  }
}

function parseHeader(value: unknown): JournalHeaderLine | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const line = value as Partial<JournalHeaderLine>;
  if (
    line.kind !== 'journal_header' ||
    typeof line.version !== 'number' ||
    typeof line.epoch !== 'string' ||
    line.epoch.length === 0 ||
    typeof line.created_at !== 'number'
  ) {
    return undefined;
  }
  return line as JournalHeaderLine;
}

function parseEvent(value: unknown): JournalEventLine | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const line = value as Partial<JournalEventLine>;
  if (
    line.kind !== 'event' ||
    typeof line.seq !== 'number' ||
    !Number.isSafeInteger(line.seq) ||
    line.seq <= 0 ||
    typeof line.envelope !== 'object' ||
    line.envelope === null
  ) {
    return undefined;
  }
  return line as JournalEventLine;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
  } catch {
    return undefined;
  }
}

function isIncompleteJson(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') && !trimmed.endsWith('}');
}

async function* readLines(filePath: string): AsyncIterable<JournalRawLine> {
  let buffered = Buffer.alloc(0);
  let byteOffset = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    buffered = Buffer.concat([buffered, chunk]);
    let newlineIndex = buffered.indexOf(0x0a);
    while (newlineIndex !== -1) {
      yield decodeJournalLine(buffered.subarray(0, newlineIndex), byteOffset, true);
      byteOffset += newlineIndex + 1;
      buffered = buffered.subarray(newlineIndex + 1);
      newlineIndex = buffered.indexOf(0x0a);
    }
  }
  if (buffered.length > 0) yield decodeJournalLine(buffered, byteOffset, false);
}

function decodeJournalLine(
  bytes: Buffer,
  byteOffset: number,
  terminated: boolean,
): JournalRawLine {
  if (isUtf8(bytes)) {
    return { raw: bytes.toString('utf8'), byteOffset, terminated, incompleteUtf8: false };
  }
  if (terminated) throw new Error('invalid UTF-8 journal line');

  const incompleteTailLength = incompleteUtf8TailLength(bytes);
  if (incompleteTailLength === undefined) throw new Error('invalid UTF-8 journal line');
  const prefix = bytes.subarray(0, -incompleteTailLength);
  if (!isUtf8(prefix)) throw new Error('invalid UTF-8 journal line');
  return { raw: prefix.toString('utf8'), byteOffset, terminated, incompleteUtf8: true };
}

function incompleteUtf8TailLength(bytes: Buffer): number | undefined {
  let continuationCount = 0;
  for (let index = bytes.length - 1; index >= 0 && continuationCount < 3; index--) {
    if ((bytes[index]! & 0xc0) !== 0x80) break;
    continuationCount++;
  }

  const leadIndex = bytes.length - continuationCount - 1;
  if (leadIndex < 0) return undefined;
  const lead = bytes[leadIndex]!;
  const expectedContinuations =
    lead >= 0xc2 && lead <= 0xdf ? 1
      : lead >= 0xe0 && lead <= 0xef ? 2
        : lead >= 0xf0 && lead <= 0xf4 ? 3
          : undefined;
  if (expectedContinuations === undefined || continuationCount >= expectedContinuations) {
    return undefined;
  }
  if (continuationCount > 0) {
    const firstContinuation = bytes[leadIndex + 1]!;
    if (
      (lead === 0xe0 && firstContinuation < 0xa0) ||
      (lead === 0xed && firstContinuation > 0x9f) ||
      (lead === 0xf0 && firstContinuation < 0x90) ||
      (lead === 0xf4 && firstContinuation > 0x8f)
    ) {
      return undefined;
    }
  }
  return continuationCount + 1;
}
