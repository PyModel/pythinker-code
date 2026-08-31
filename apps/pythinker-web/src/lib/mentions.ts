export type MentionKind = 'file' | 'folder' | 'skill';

export interface MentionAttrs {
  kind: MentionKind;
  name: string;
  path: string;
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; attrs: MentionAttrs };

const MENTION_RE = /\[((?:\\[\\[\]]|[^[\]\\])*)\]\((<[^<>\n]*>|[^()\s]+)\)/g;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:(?:[\\/]|%5c)/i;
const SAFE_PATH_ASCII_RE = /^[A-Za-z0-9._~-]$/;
export const SKILL_MENTION_SCHEME = 'pythinker-code://skill/';

let graphemeSegmenter: Intl.Segmenter | undefined;

function escapeName(name: string): string {
  return name
    .replaceAll('%', '%25')
    .replaceAll('&', '%26')
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll(/[[\]\\]/g, '\\$&')
    .replaceAll('\n', '%0A')
    .replaceAll('\r', '%0D');
}

function unescapeName(name: string): string {
  return name
    .replaceAll(/\\([\\[\]])/g, '$1')
    .replaceAll('%26', '&')
    .replaceAll('%3C', '<')
    .replaceAll('%3E', '>')
    .replaceAll('%0A', '\n')
    .replaceAll('%0D', '\r')
    .replaceAll('%25', '%');
}

function encodeSegment(segment: string): string {
  let result = '';
  for (const character of segment) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 127 || SAFE_PATH_ASCII_RE.test(character)) result += character;
    else result += `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return result;
}

function encodePath(path: string): string {
  const encoded = path.split('/').map(encodeSegment).join('/');
  return encoded.startsWith('//') ? `/%2F${encoded.slice(2)}` : encoded;
}

function stripAngles(destination: string): string {
  return destination.startsWith('<') && destination.endsWith('>')
    ? destination.slice(1, -1)
    : destination;
}

function decodeDestination(destination: string): string {
  const raw = stripAngles(destination);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function classifyDestination(destination: string): MentionKind | null {
  const raw = stripAngles(destination);
  if (!raw || raw.startsWith('#') || raw.startsWith('?') || raw.startsWith('//')) return null;
  if (raw.startsWith(SKILL_MENTION_SCHEME) && raw.length > SKILL_MENTION_SCHEME.length) {
    return 'skill';
  }
  if (URL_SCHEME_RE.test(raw) && !WINDOWS_DRIVE_RE.test(raw)) return null;
  return /(?:[\\/]|%5c)$/i.test(raw) ? 'folder' : 'file';
}

function appendText(segments: MentionSegment[], value: string): void {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.type === 'text') previous.value += value;
  else segments.push({ type: 'text', value });
}

export function serializeMention(attrs: MentionAttrs): string {
  if (attrs.kind === 'skill') {
    return `[${escapeName(attrs.name)}](${SKILL_MENTION_SCHEME}${encodeSegment(attrs.name)})`;
  }
  const path = attrs.kind === 'folder' && !/[\\/]$/.test(attrs.path) ? `${attrs.path}/` : attrs.path;
  return `[${escapeName(attrs.name)}](${encodePath(path)})`;
}

export function parseMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  MENTION_RE.lastIndex = 0;

  for (const match of text.matchAll(MENTION_RE)) {
    const index = match.index;
    appendText(segments, text.slice(cursor, index));
    const raw = match[0];
    const label = match[1]!;
    const destination = match[2]!;
    const kind = text[index - 1] === '!' ? null : classifyDestination(destination);
    if (kind && label) {
      const skillName =
        kind === 'skill'
          ? decodeDestination(destination).slice(SKILL_MENTION_SCHEME.length)
          : undefined;
      segments.push({
        type: 'mention',
        attrs: {
          kind,
          name: skillName ?? unescapeName(label),
          path: kind === 'skill' ? '' : decodeDestination(destination),
        },
      });
    } else {
      appendText(segments, raw);
    }
    cursor = index + raw.length;
  }

  appendText(segments, text.slice(cursor));
  return segments;
}

export interface SkillActivation {
  name: string;
  args?: string;
}

function hasOwnSkillPill(activation: SkillActivation): boolean {
  const mentions = parseMentionSegments(activation.args ?? '').filter(
    (segment) => segment.type === 'mention' && segment.attrs.kind === 'skill',
  );
  const mention = mentions[0];
  return mentions.length === 1 && mention?.type === 'mention' && mention.attrs.name === activation.name;
}

export function serializeSkillActivation(
  activation: SkillActivation,
  options: { revivePill: boolean },
): string | null {
  if (hasOwnSkillPill(activation)) return options.revivePill ? (activation.args ?? '') : null;
  if (activation.name.includes(' ')) return null;
  const args = activation.args ?? '';
  return `/skill:${activation.name}${args.length > 0 ? ` ${args}` : ''}`;
}

export function isRevivableSkillActivation(
  activation: SkillActivation,
  options: { revivePill: boolean },
): boolean {
  return serializeSkillActivation(activation, options) !== null;
}

export function skillActivationDisplayText(activation: SkillActivation): string {
  if (hasOwnSkillPill(activation)) return activation.args ?? '';
  const pill = serializeMention({ kind: 'skill', name: activation.name, path: '' });
  return activation.args ? `${pill} ${activation.args}` : pill;
}

function graphemes(value: string): string[] {
  graphemeSegmenter ??= new Intl.Segmenter('und', { granularity: 'grapheme' });
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

export function middleTruncateName(name: string): string {
  const parts = graphemes(name);
  if (parts.length <= 32) return name;

  const dot = name.lastIndexOf('.');
  const extensionLength = dot >= 0 ? graphemes(name.slice(dot)).length : 0;
  const tailLength = extensionLength + 4;
  const headLength = 31 - tailLength;
  if (headLength < 8) return `${parts.slice(0, 31).join('')}…`;
  return `${parts.slice(0, headLength).join('')}…${parts.slice(-tailLength).join('')}`;
}
