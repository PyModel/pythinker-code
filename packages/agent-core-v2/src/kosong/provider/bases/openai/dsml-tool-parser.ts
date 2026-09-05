import type { StreamedMessagePart, ToolCall } from '#/kosong/contract/message';

const MARK = String.raw`\s*[｜|]?\s*(?:DSML\s*[｜|]?)?\s*`;
const CONTAINER_OPEN_RE = new RegExp(String.raw`<${MARK}tool_calls\s*>`, 'yi');
const CONTAINER_CLOSE_RE = new RegExp(String.raw`</${MARK}tool_calls\s*>`, 'yi');
const INVOKE_OPEN_RE = new RegExp(String.raw`<${MARK}invoke(?:\s+[^>]*)?>`, 'yi');
const INVOKE_CLOSE_RE = new RegExp(String.raw`</${MARK}invoke\s*>`, 'gi');
const PARAM_OPEN_RE = new RegExp(String.raw`<${MARK}parameter\s+([^>]*?)>`, 'yi');
const PARAM_CLOSE_RE = new RegExp(String.raw`</${MARK}parameter\s*>`, 'gi');
const HERMES_OPEN_RE = /<tool_call>/yi;
const HERMES_CLOSE_RE = /<\/tool_call>/gi;
const MARKED_RE = /<\/?\s*(?:[｜|]|DSML)/yi;
const NAME_ATTR_RE = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
const STRING_ATTR_RE = /\bstring\s*=\s*(?:"(true|false)"|'(true|false)'|(true|false))/i;

export const DSML_MAX_TAG_CHARS = 4096;
export const DSML_MAX_ENVELOPE_CHARS = 2 * 1024 * 1024;
const TAIL_MAX = 1024;
const TAG_NAMES = ['tool_calls', 'tool_call', 'invoke', 'parameter'];

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseParameterValue(rawVal: string, isStringAttr: boolean | undefined): unknown {
  const unescaped = unescapeXml(rawVal);
  if (isStringAttr === true) {
    return unescaped;
  }
  const trimmed = unescaped.trim();
  if (isStringAttr === false) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    (trimmed.length > 0 && !Number.isNaN(Number(trimmed))) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return unescaped;
    }
  }
  return unescaped;
}

function attrValue(match: RegExpExecArray | null): string | undefined {
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

function skipWhitespace(text: string, from: number): number {
  let pos = from;
  while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1;
  return pos;
}

function stickyExec(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

export function parseInvokeBody(invokeContent: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let pos = skipWhitespace(invokeContent, 0);
  if (pos === invokeContent.length) return args;

  if (invokeContent[pos] === '{') {
    const trimmed = invokeContent.trim();
    if (!trimmed.endsWith('}')) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      for (const key of Object.keys(parsed)) {
        args[key] = (parsed as Record<string, unknown>)[key];
      }
      return args;
    } catch {
      return null;
    }
  }

  while (pos < invokeContent.length) {
    const open = stickyExec(PARAM_OPEN_RE, invokeContent, pos);
    if (!open) return null;
    const attrStr = open[1] ?? '';
    const paramName = attrValue(NAME_ATTR_RE.exec(attrStr));
    if (!paramName) return null;
    const valueStart = open.index + open[0].length;
    const close = stickyExec(PARAM_CLOSE_RE, invokeContent, valueStart);
    if (!close) return null;
    const stringAttrVal = attrValue(STRING_ATTR_RE.exec(attrStr));
    const isStringAttr =
      stringAttrVal !== undefined ? stringAttrVal.toLowerCase() === 'true' : undefined;
    args[paramName] = parseParameterValue(
      invokeContent.slice(valueStart, close.index),
      isStringAttr,
    );
    pos = skipWhitespace(invokeContent, close.index + close[0].length);
  }
  return args;
}

function newCallId(): string {
  return `call_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function parseInvokeTag(invokeBlock: string): ToolCall | null {
  const openMatch = stickyExec(INVOKE_OPEN_RE, invokeBlock, 0);
  if (!openMatch) return null;
  const toolName = attrValue(NAME_ATTR_RE.exec(openMatch[0].slice(0, -1)));
  if (!toolName) return null;

  const closeMatch = stickyExec(INVOKE_CLOSE_RE, invokeBlock, openMatch[0].length);
  if (!closeMatch || closeMatch.index + closeMatch[0].length !== invokeBlock.length) return null;
  const args = parseInvokeBody(invokeBlock.slice(openMatch[0].length, closeMatch.index));
  if (args === null) return null;
  return { type: 'function', id: newCallId(), name: toolName, arguments: JSON.stringify(args) };
}

function parseHermesToolCall(toolCallBlock: string): ToolCall | null {
  const inner = toolCallBlock
    .replace(/^<tool_call>/i, '')
    .replace(/<\/tool_call>$/i, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(inner);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record['name'] !== 'string') return null;
    const rawArgs = record['arguments'];
    const args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
    return { type: 'function', id: newCallId(), name: record['name'], arguments: args };
  } catch {
    return null;
  }
}

type TagKind =
  | 'container-open'
  | 'container-close'
  | 'invoke-open'
  | 'hermes-open'
  | 'partial'
  | 'none';

function markerPrefixState(lower: string): { rest: string; partial: boolean } {
  let rest = lower.startsWith('</') ? lower.slice(2) : lower.slice(1);
  rest = rest.trimStart();
  if (rest.startsWith('｜') || rest.startsWith('|')) rest = rest.slice(1).trimStart();
  if (rest.length > 0 && rest.length < 4 && 'dsml'.startsWith(rest)) {
    return { rest: '', partial: true };
  }
  if (rest.startsWith('dsml')) {
    rest = rest.slice(4).trimStart();
    if (rest.startsWith('｜') || rest.startsWith('|')) rest = rest.slice(1).trimStart();
  }
  return { rest, partial: rest.length === 0 };
}

function classifyTag(buffer: string, at: number): { kind: TagKind; length: number } {
  const containerOpen = stickyExec(CONTAINER_OPEN_RE, buffer, at);
  if (containerOpen) return { kind: 'container-open', length: containerOpen[0].length };
  const containerClose = stickyExec(CONTAINER_CLOSE_RE, buffer, at);
  if (containerClose) return { kind: 'container-close', length: containerClose[0].length };
  const invokeOpen = stickyExec(INVOKE_OPEN_RE, buffer, at);
  if (invokeOpen) return { kind: 'invoke-open', length: invokeOpen[0].length };
  const hermesOpen = stickyExec(HERMES_OPEN_RE, buffer, at);
  if (hermesOpen) return { kind: 'hermes-open', length: hermesOpen[0].length };

  const lower = buffer.slice(at, at + DSML_MAX_TAG_CHARS + 1).toLowerCase();
  const { rest, partial } = markerPrefixState(lower);
  if (partial) return { kind: 'partial', length: 0 };
  if (rest.includes('>')) return { kind: 'none', length: 0 };
  for (const name of TAG_NAMES) {
    if (name.startsWith(rest)) return { kind: 'partial', length: 0 };
    if (rest.startsWith(name)) {
      const after = rest.slice(name.length);
      if (after.length === 0 || /^\s/.test(after)) return { kind: 'partial', length: 0 };
    }
  }
  return { kind: 'none', length: 0 };
}

type Mode = 'text' | 'invoke' | 'hermes';

interface ContainerHold {
  raw: string;
  parts: StreamedMessagePart[];
}

export class DsmlStreamParser {
  private _buffer = '';
  private _pos = 0;
  private _mode: Mode = 'text';
  private _envelope: string[] = [];
  private _envelopeLength = 0;
  private _tail = '';
  private _stripWhitespace = false;
  private _whitespaceHold = '';
  private _inContainer = false;
  private _hold: ContainerHold | null = null;
  private _lineStart = true;
  private _linePrefix = '';
  private _fence: string | null = null;
  private _hasExtractedToolCalls = false;

  get hasExtractedToolCalls(): boolean {
    return this._hasExtractedToolCalls;
  }

  feed(chunk: string): StreamedMessagePart[] {
    const parts: StreamedMessagePart[] = [];
    if (this._mode === 'text') {
      this._buffer += chunk;
    } else {
      this._scanEnvelope(parts, chunk);
    }
    if (this._mode === 'text') {
      this._drainText(parts);
    }
    return parts;
  }

  flush(): StreamedMessagePart[] {
    const parts: StreamedMessagePart[] = [];
    if (this._mode !== 'text') {
      const block = this._envelope.join('') + this._tail;
      this._leaveEnvelope();
      this._buffer = block;
      this._pos = 0;
    }
    if (this._whitespaceHold.length > 0) {
      this._emitText(parts, this._whitespaceHold.replace(/^\r?\n/, ''));
      this._whitespaceHold = '';
    }
    this._stripWhitespace = false;
    if (this._pos < this._buffer.length) {
      this._emitText(parts, this._take(this._buffer.length - this._pos));
    }
    this._buffer = '';
    this._pos = 0;
    if (this._inContainer) {
      this._releaseHold(parts, true);
      this._inContainer = false;
    }
    return parts;
  }

  private _drainText(parts: StreamedMessagePart[]): void {
    while (this._pos < this._buffer.length) {
      if (this._stripWhitespace) {
        const end = skipWhitespace(this._buffer, this._pos);
        if (end > this._pos) {
          this._whitespaceHold += this._take(end - this._pos);
        }
        if (this._pos >= this._buffer.length) break;
        this._stripWhitespace = false;
        if (this._buffer[this._pos] === '<') {
          this._noteText(this._whitespaceHold);
        } else {
          this._emitText(parts, this._whitespaceHold.replace(/^\r?\n/, ''));
        }
        this._whitespaceHold = '';
      }

      const ltIdx = this._buffer.indexOf('<', this._pos);
      if (ltIdx === -1) {
        this._emitText(parts, this._take(this._buffer.length - this._pos));
        break;
      }
      if (ltIdx > this._pos) {
        this._emitText(parts, this._take(ltIdx - this._pos));
        continue;
      }

      if (this._fence !== null) {
        const nl = this._buffer.indexOf('\n', this._pos);
        this._emitText(parts, this._take((nl === -1 ? this._buffer.length : nl + 1) - this._pos));
        continue;
      }

      const tag = classifyTag(this._buffer, this._pos);
      if (tag.kind === 'partial') {
        if (this._buffer.length - this._pos > DSML_MAX_TAG_CHARS) {
          this._emitPlainTag(parts);
          continue;
        }
        break;
      }
      if (tag.kind === 'container-open') {
        if (!this._inContainer) {
          this._inContainer = true;
          this._hold = { raw: '', parts: [] };
        }
        this._take(tag.length);
        this._stripWhitespace = true;
        continue;
      }
      if (tag.kind === 'container-close' && this._inContainer) {
        this._take(tag.length);
        this._releaseHold(parts, true);
        this._inContainer = false;
        this._stripWhitespace = true;
        continue;
      }
      if (
        tag.kind === 'invoke-open' &&
        (this._inContainer || stickyExec(MARKED_RE, this._buffer, this._pos) !== null)
      ) {
        this._enterEnvelope(parts, 'invoke');
        return;
      }
      if (tag.kind === 'hermes-open') {
        this._enterEnvelope(parts, 'hermes');
        return;
      }

      this._emitPlainTag(parts);
    }

    this._buffer = this._buffer.slice(this._pos);
    this._pos = 0;
  }

  private _emitPlainTag(parts: StreamedMessagePart[]): void {
    const nextLt = this._buffer.indexOf('<', this._pos + 1);
    this._emitText(parts, this._take((nextLt === -1 ? this._buffer.length : nextLt) - this._pos));
  }

  private _enterEnvelope(parts: StreamedMessagePart[], mode: Mode): void {
    const incoming = this._buffer.slice(this._pos);
    this._buffer = '';
    this._pos = 0;
    this._mode = mode;
    this._envelope = [];
    this._envelopeLength = 0;
    this._tail = '';
    this._scanEnvelope(parts, incoming);
    if (this._mode === 'text') {
      this._drainText(parts);
    }
  }

  private _leaveEnvelope(): void {
    this._mode = 'text';
    this._envelope = [];
    this._envelopeLength = 0;
    this._tail = '';
  }

  private _scanEnvelope(parts: StreamedMessagePart[], incoming: string): void {
    const probe = this._tail + incoming;
    const closeRe = this._mode === 'invoke' ? INVOKE_CLOSE_RE : HERMES_CLOSE_RE;
    const close = stickyExec(closeRe, probe, 0);
    if (close) {
      const end = close.index + close[0].length;
      const block = this._envelope.join('') + probe.slice(0, end);
      const rest = probe.slice(end);
      const mode = this._mode;
      this._leaveEnvelope();
      if (block.length > DSML_MAX_ENVELOPE_CHARS) {
        this._abandonEnvelope(parts, block, rest);
        return;
      }
      const call = mode === 'invoke' ? parseInvokeTag(block) : parseHermesToolCall(block);
      this._record(block);
      if (call) {
        this._emitCall(parts, call);
        this._stripWhitespace = true;
      } else {
        this._emitText(parts, block);
      }
      this._buffer = rest;
      this._pos = 0;
      return;
    }

    if (this._envelopeLength + probe.length >= DSML_MAX_ENVELOPE_CHARS) {
      const block = this._envelope.join('') + probe;
      this._leaveEnvelope();
      this._abandonEnvelope(parts, block, '');
      return;
    }

    const lastLt = probe.lastIndexOf('<');
    if (lastLt === -1 || probe.length - lastLt > TAIL_MAX) {
      this._envelope.push(probe);
      this._envelopeLength += probe.length;
      this._tail = '';
    } else {
      const committed = probe.slice(0, lastLt);
      this._envelope.push(committed);
      this._envelopeLength += committed.length;
      this._tail = probe.slice(lastLt);
    }
  }

  private _abandonEnvelope(parts: StreamedMessagePart[], block: string, rest: string): void {
    const nextLt = block.indexOf('<', 1);
    const cut = nextLt === -1 ? block.length : nextLt;
    const text = block.slice(0, cut);
    this._record(text);
    this._emitText(parts, text);
    this._buffer = block.slice(cut) + rest;
    this._pos = 0;
  }

  private _take(length: number): string {
    const taken = this._buffer.slice(this._pos, this._pos + length);
    this._pos += length;
    this._record(taken);
    return taken;
  }

  private _record(text: string): void {
    if (this._hold === null) return;
    this._hold.raw += text;
  }

  private _releaseHold(parts: StreamedMessagePart[], asText: boolean): void {
    const hold = this._hold;
    this._hold = null;
    if (hold === null) return;
    if (asText) {
      if (hold.raw.length > 0) parts.push({ type: 'text', text: hold.raw });
    } else {
      parts.push(...hold.parts);
    }
  }

  private _emitCall(parts: StreamedMessagePart[], call: ToolCall): void {
    this._hasExtractedToolCalls = true;
    this._releaseHold(parts, false);
    parts.push(call);
  }

  private _emitText(parts: StreamedMessagePart[], text: string): void {
    if (text.length === 0) return;
    this._noteText(text);
    const part: StreamedMessagePart = { type: 'text', text };
    if (this._hold !== null) {
      this._hold.parts.push(part);
      if (this._hold.raw.length > DSML_MAX_ENVELOPE_CHARS) {
        this._releaseHold(parts, true);
      }
      return;
    }
    parts.push(part);
  }

  private _noteText(text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        this._lineStart = true;
        this._linePrefix = '';
        continue;
      }
      if (!this._lineStart) continue;
      if (ch === ' ' && this._linePrefix.length < 3 && /^ *$/.test(this._linePrefix)) {
        this._linePrefix += ch;
        continue;
      }
      if (ch !== '`' && ch !== '~') {
        this._lineStart = false;
        continue;
      }
      const run = this._linePrefix.trimStart();
      if (run.length > 0 && run[0] !== ch) {
        this._lineStart = false;
        continue;
      }
      this._linePrefix += ch;
      if (run.length + 1 === 3) {
        this._lineStart = false;
        if (this._fence === null) {
          this._fence = ch;
        } else if (this._fence === ch) {
          this._fence = null;
        }
      }
    }
  }
}

export function extractDsmlToolCalls(text: string): {
  cleanText: string;
  toolCalls: ToolCall[];
} {
  const parser = new DsmlStreamParser();
  const parts = [...parser.feed(text), ...parser.flush()];
  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.type === 'function') {
      toolCalls.push(part);
    } else if (part.type === 'text') {
      textParts.push(part.text);
    }
  }

  const joined = textParts.join('');
  return { cleanText: toolCalls.length > 0 ? joined.trim() : joined, toolCalls };
}
