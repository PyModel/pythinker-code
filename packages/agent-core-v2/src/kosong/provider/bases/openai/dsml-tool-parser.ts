import type { StreamedMessagePart, ToolCall } from '#/kosong/contract/message';

const CANDIDATE_TARGETS = [
  'dsml｜tool_calls',
  'dsml|tool_calls',
  'dsmltool_calls',
  'dsml｜invoke',
  'dsml|invoke',
  'dsmlinvoke',
  'tool_calls',
  'tool_call',
  'invoke',
];

const CONTAINER_OPEN_RE = /^<[｜|]?\s*(?:DSML[｜|]?)?\s*tool_calls\s*>/i;
const CONTAINER_CLOSE_RE = /^<\/[｜|]?\s*(?:DSML[｜|]?)?\s*tool_calls\s*>/i;
const INVOKE_OPEN_RE = /^<[｜|]?\s*(?:DSML[｜|]?)?\s*invoke(?:\s+[^>]*)?>/i;
const INVOKE_CLOSE_RE = /<\/[｜|]?\s*(?:DSML[｜|]?)?\s*invoke\s*>/i;
const HERMES_OPEN_RE = /^<tool_call>/i;
const HERMES_CLOSE_RE = /<\/tool_call>/i;

function unescapeXml(value: string): string {
  return value
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&apos;/g, "'")
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/&amp;/g, '&');
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

function parseInvokeBody(invokeContent: string): Record<string, unknown> {
  const paramRegex =
    /<[｜|]?\s*(?:DSML[｜|]?)?\s*parameter\s+([^>]*?)>([\s\S]*?)<\/[｜|]?\s*(?:DSML[｜|]?)?\s*parameter\s*>/gi;
  const args: Record<string, unknown> = {};
  let paramFound = false;
  let match: RegExpExecArray | null = null;

  while ((match = paramRegex.exec(invokeContent)) !== null) {
    const attrStr = match[1] ?? '';
    const rawVal = match[2] ?? '';
    const nameMatch = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrStr);
    const paramName = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]) : undefined;
    if (paramName) {
      paramFound = true;
      const stringAttrMatch =
        /\bstring\s*=\s*(?:"(true|false)"|'(true|false)'|(true|false))/i.exec(attrStr);
      const stringAttrVal = stringAttrMatch
        ? (stringAttrMatch[1] ?? stringAttrMatch[2] ?? stringAttrMatch[3])
        : undefined;
      const isStringAttr =
        stringAttrVal !== undefined ? stringAttrVal.toLowerCase() === 'true' : undefined;
      args[paramName] = parseParameterValue(rawVal, isStringAttr);
    }
  }

  if (paramFound) {
    return args;
  }

  const trimmed = invokeContent.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }

  return {};
}

function parseInvokeTag(invokeBlock: string): ToolCall | null {
  const openMatch = /^<[｜|]?\s*(?:DSML[｜|]?)?\s*invoke\s+([^>]*?)>/i.exec(invokeBlock);
  if (!openMatch) return null;

  const attrStr = openMatch[1] ?? '';
  const nameMatch = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrStr);
  const toolName = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]) : undefined;
  if (!toolName) return null;

  const closeMatch = INVOKE_CLOSE_RE.exec(invokeBlock);
  const innerContent = closeMatch
    ? invokeBlock.slice(openMatch[0].length, closeMatch.index)
    : invokeBlock.slice(openMatch[0].length);

  const args = parseInvokeBody(innerContent);
  return {
    type: 'function',
    id: `call_${crypto.randomUUID().replaceAll(/-/g, '').slice(0, 24)}`,
    name: toolName,
    arguments: JSON.stringify(args),
  };
}

function parseHermesToolCall(toolCallBlock: string): ToolCall | null {
  const inner = toolCallBlock
    .replace(/^<tool_call>/i, '')
    .replace(/<\/tool_call>$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(inner);
    if (parsed && typeof parsed.name === 'string') {
      const args =
        typeof parsed.arguments === 'string'
          ? parsed.arguments
          : JSON.stringify(parsed.arguments ?? {});
      return {
        type: 'function',
        id: `call_${crypto.randomUUID().replaceAll(/-/g, '').slice(0, 24)}`,
        name: parsed.name,
        arguments: args,
      };
    }
  } catch {}
  return null;
}

function isPotentialTagPrefix(s: string): boolean {
  if (!s.startsWith('<')) return false;
  const lower = s.toLowerCase();
  let rest = lower.startsWith('</') ? lower.slice(2) : lower.slice(1);
  if (rest.startsWith('｜') || rest.startsWith('|')) {
    rest = rest.slice(1);
  }
  if (rest.length === 0) return true;
  return CANDIDATE_TARGETS.some((target) => target.startsWith(rest) || rest.startsWith(target));
}

export class DsmlStreamParser {
  private _buffer = '';
  private _hasExtractedToolCalls = false;

  get hasExtractedToolCalls(): boolean {
    return this._hasExtractedToolCalls;
  }

  feed(chunk: string): StreamedMessagePart[] {
    this._buffer += chunk;
    const parts: StreamedMessagePart[] = [];

    while (this._buffer.length > 0) {
      const ltIdx = this._buffer.indexOf('<');
      if (ltIdx === -1) {
        parts.push({ type: 'text', text: this._buffer });
        this._buffer = '';
        break;
      }

      if (ltIdx > 0) {
        parts.push({ type: 'text', text: this._buffer.slice(0, ltIdx) });
        this._buffer = this._buffer.slice(ltIdx);
      }

      const openContainer = CONTAINER_OPEN_RE.exec(this._buffer);
      if (openContainer) {
        this._buffer = this._buffer.slice(openContainer[0].length);
        if (/^\s*</.test(this._buffer)) {
          this._buffer = this._buffer.trimStart();
        } else {
          this._buffer = this._buffer.replace(/^\r?\n/, '');
        }
        continue;
      }

      const closeContainer = CONTAINER_CLOSE_RE.exec(this._buffer);
      if (closeContainer) {
        this._buffer = this._buffer.slice(closeContainer[0].length);
        if (/^\s*</.test(this._buffer)) {
          this._buffer = this._buffer.trimStart();
        } else {
          this._buffer = this._buffer.replace(/^\r?\n/, '');
        }
        continue;
      }

      const invokeOpen = INVOKE_OPEN_RE.exec(this._buffer);
      if (invokeOpen) {
        const closeMatch = INVOKE_CLOSE_RE.exec(this._buffer);
        if (!closeMatch) {
          break;
        }
        const invokeEnd = closeMatch.index + closeMatch[0].length;
        const invokeBlock = this._buffer.slice(0, invokeEnd);
        const toolCall = parseInvokeTag(invokeBlock);
        if (toolCall) {
          this._hasExtractedToolCalls = true;
          parts.push(toolCall);
        }
        this._buffer = this._buffer.slice(invokeEnd);
        if (/^\s*</.test(this._buffer)) {
          this._buffer = this._buffer.trimStart();
        } else {
          this._buffer = this._buffer.replace(/^\r?\n/, '');
        }
        continue;
      }

      const hermesOpen = HERMES_OPEN_RE.exec(this._buffer);
      if (hermesOpen) {
        const closeMatch = HERMES_CLOSE_RE.exec(this._buffer);
        if (!closeMatch) {
          break;
        }
        const toolCallEnd = closeMatch.index + closeMatch[0].length;
        const block = this._buffer.slice(0, toolCallEnd);
        const toolCall = parseHermesToolCall(block);
        if (toolCall) {
          this._hasExtractedToolCalls = true;
          parts.push(toolCall);
        }
        this._buffer = this._buffer.slice(toolCallEnd);
        if (/^\s*</.test(this._buffer)) {
          this._buffer = this._buffer.trimStart();
        } else {
          this._buffer = this._buffer.replace(/^\r?\n/, '');
        }
        continue;
      }

      if (isPotentialTagPrefix(this._buffer)) {
        break;
      }

      const nextLt = this._buffer.indexOf('<', 1);
      if (nextLt === -1) {
        parts.push({ type: 'text', text: this._buffer });
        this._buffer = '';
        break;
      }

      parts.push({ type: 'text', text: this._buffer.slice(0, nextLt) });
      this._buffer = this._buffer.slice(nextLt);
    }

    return parts;
  }

  flush(): StreamedMessagePart[] {
    const parts: StreamedMessagePart[] = [];
    if (this._buffer.length > 0) {
      const invokeOpen = INVOKE_OPEN_RE.exec(this._buffer);
      if (invokeOpen) {
        const toolCall = parseInvokeTag(this._buffer);
        if (toolCall) {
          this._hasExtractedToolCalls = true;
          parts.push(toolCall);
          this._buffer = '';
          return parts;
        }
      }
      parts.push({ type: 'text', text: this._buffer });
      this._buffer = '';
    }
    return parts;
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

  const cleanText = textParts.join('').trim();
  return { cleanText, toolCalls };
}
