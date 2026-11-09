const ANSWER_FIELD = '"answer":"';

// The Fusion stage streams a JSON envelope ({"version":..., "answer": "...",
// "notes": ...}). Until the run finishes, show the reader the answer text as
// it arrives instead of the raw envelope. Returns undefined when the text is
// not such an envelope, so plain prose passes through untouched.
export function extractStreamingAnswer(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const source = text.trimStart();
  if (!source.startsWith('{')) return undefined;
  const start = source.indexOf(ANSWER_FIELD);
  if (start === -1) return '';
  let cursor = start + ANSWER_FIELD.length;
  let fragment = '';
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '"') break;
    if (char === '\\') {
      if (cursor + 1 >= source.length) break;
      const escaped = source.slice(cursor, cursor + 2);
      if (escaped === '\\u') {
        if (cursor + 6 > source.length) break;
        fragment += source.slice(cursor, cursor + 6);
        cursor += 6;
        continue;
      }
      fragment += escaped;
      cursor += 2;
      continue;
    }
    fragment += char;
    cursor += 1;
  }
  try {
    return JSON.parse(`"${fragment}"`) as string;
  } catch {
    return fragment;
  }
}
