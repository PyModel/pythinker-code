import type { ContentPart } from '#/kosong/contract/message';
import { matchSingleMediaPathTag } from '#/agent/media/mediaRef';
import { extractImageCompressionCaptions } from '#/agent/media/image-compress';

const MAX_TITLE_LENGTH = 200;
const MAX_LAST_PROMPT_LENGTH = 4000;

export function titleFromPromptMetadataText(text: string): string {
  return text.slice(0, MAX_TITLE_LENGTH);
}

export function promptMetadataTextFromContentParts(
  parts: readonly ContentPart[],
): string | undefined {
  const texts: string[] = [];
  for (const part of parts) {
    const text = promptPartText(part);
    if (text !== undefined) texts.push(text);
  }
  return promptMetadataTextFromText(texts.join('\n'));
}

export function promptMetadataTextFromText(text: string): string | undefined {
  const sanitized = redactPrivateKeys(text)
    .replaceAll(/\b(authorization)\s*:\s*bearer\s+\S+/gi, '$1: Bearer [redacted]')
    .replaceAll(
      /\b(api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1=[redacted]',
    )
    .replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replaceAll(/\b[A-Za-z0-9][A-Za-z0-9+/=_-]{39,}\b/g, '[redacted]')
    .replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (sanitized.length === 0) return undefined;
  return sanitized.slice(0, MAX_LAST_PROMPT_LENGTH);
}

function redactPrivateKeys(text: string): string {
  const boundary = '-----';
  const begin = '-----BEGIN ';
  const end = '-----END ';
  const kind = 'PRIVATE KEY';
  const output: string[] = [];
  let emitted = 0;
  let search = 0;

  while (search < text.length) {
    const beginAt = indexOfAsciiCaseInsensitive(text, begin, search);
    if (beginAt === -1) break;
    const headerEnd = text.indexOf(boundary, beginAt + begin.length);
    if (headerEnd === -1) break;
    const headerKindStart = beginAt + begin.length;
    const headerPrefixEnd = headerEnd - kind.length;
    if (
      headerPrefixEnd < headerKindStart ||
      !matchesAsciiCaseInsensitiveAt(text, kind, headerPrefixEnd) ||
      text.slice(headerKindStart, headerPrefixEnd).includes('-')
    ) {
      search = headerEnd + boundary.length;
      continue;
    }

    let endSearch = headerEnd + boundary.length;
    let blockEnd = -1;
    while (endSearch < text.length) {
      const endAt = indexOfAsciiCaseInsensitive(text, end, endSearch);
      if (endAt === -1) break;
      const footerEnd = text.indexOf(boundary, endAt + end.length);
      if (footerEnd === -1) break;
      const footerKindStart = endAt + end.length;
      const footerPrefixEnd = footerEnd - kind.length;
      if (
        footerPrefixEnd >= footerKindStart &&
        matchesAsciiCaseInsensitiveAt(text, kind, footerPrefixEnd) &&
        !text.slice(footerKindStart, footerPrefixEnd).includes('-')
      ) {
        blockEnd = footerEnd + boundary.length;
        break;
      }
      endSearch = footerEnd + boundary.length;
    }
    if (blockEnd === -1) break;

    output.push(text.slice(emitted, beginAt), '[redacted]');
    emitted = blockEnd;
    search = blockEnd;
  }

  output.push(text.slice(emitted));
  return output.join('');
}

function indexOfAsciiCaseInsensitive(text: string, search: string, from: number): number {
  for (let index = from; index <= text.length - search.length; index += 1) {
    if (matchesAsciiCaseInsensitiveAt(text, search, index)) return index;
  }
  return -1;
}

function matchesAsciiCaseInsensitiveAt(text: string, search: string, at: number): boolean {
  for (let index = 0; index < search.length; index += 1) {
    const actual = text.charCodeAt(at + index);
    const expected = search.charCodeAt(index);
    const foldedActual = actual >= 65 && actual <= 90 ? actual + 32 : actual;
    const foldedExpected = expected >= 65 && expected <= 90 ? expected + 32 : expected;
    if (foldedActual !== foldedExpected) return false;
  }
  return true;
}

function promptPartText(part: ContentPart): string | undefined {
  switch (part.type) {
    case 'text': {
      if (matchSingleMediaPathTag(part.text) !== undefined) return undefined;
      const { text } = extractImageCompressionCaptions(part.text);
      return text.trim().length === 0 ? undefined : text;
    }
    case 'image_url':
      return '[image]';
    case 'audio_url':
      return '[audio]';
    case 'video_url':
      return '[video]';
    case 'think':
      return undefined;
  }
}
