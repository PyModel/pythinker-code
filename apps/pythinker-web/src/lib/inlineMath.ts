// apps/pythinker-web/src/lib/inlineMath.ts
// Curated `$…$` inline-math detector, ported from the reference web UI
// (compiled bundle `VBe`/`ZBe`). The stock markdown-it `math` rule is too
// permissive for prose that talks about money and shell, so this detector
// renders real math (`$x^2$`, `$E=mc^2$`) while keeping prices, env vars and
// paths literal: `$5`, `$10.99`, `$PATH`, `$HOME/bin`, `US$ 100`, `$5 ~ $10`.

export interface InlineMathMatch {
  content: string;
  /** Index just past the closing `$`. */
  end: number;
}

export type InlineMathMatcher = (pos: number, lastEnd?: number) => InlineMathMatch | null;

/** True when `index` is preceded by an odd number of backslashes (escaped). */
function hasEscapingBackslash(source: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

const WHITESPACE_RE = /\s/;
const DIGIT_RE = /\p{Nd}/u;

/** Code point at `index` (surrogate pairs handled), or undefined at EOF. */
function charAt(source: string, index: number): string | undefined {
  const codePoint = source.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

/** Code point immediately before `index`, or undefined at the start. */
function prevChar(source: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const code = source.codePointAt(index - 1);
  const start = code >= 0xd800 && code <= 0xdbff && index > 1 ? index - 2 : index - 1;
  const codePoint = source.codePointAt(start);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && WHITESPACE_RE.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && DIGIT_RE.test(char);
}

function isUppercase(char: string | undefined): boolean {
  return char !== undefined && char >= 'A' && char <= 'Z';
}

/** ISO 4217 codes plus the informal ones people actually write (`HK$`, `US$`). */
const CURRENCY_CODES_RE = new RegExp(
  String.raw`^(?:AED|AFN|ALL|AMD|ANG|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BGN|BHD|BIF|BMD|BND|BOB|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHF|CLF|CLP|CNY|COP|CRC|CUC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HRK|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SLL|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|UYU|UZS|VED|VES|VND|VUV|WST|XAF|XCD|XOF|XPF|YER|ZAR|ZMW|ZWL|HK|US|SG|AU|CA|NZ|NT|TW|RMB|MEX|TT|BZ|EU|UK)$`,
);

/** `HBe`: `$` preceded by an uppercase currency code (`US$5`, `$HK`). */
function currencyBeforeDollar(source: string, index: number): boolean {
  if (!isUppercase(source[index - 1])) return false;
  let start = index - 1;
  while (start > 0 && isUppercase(source[start - 1])) start--;
  return CURRENCY_CODES_RE.test(source.slice(start, index)) || isDigit(charAt(source, index + 1))
    ? true
    : index - start <= 2 &&
        !/[\p{L}\p{Nd}]/u.test(source[start - 1] ?? '') &&
        !/\p{L}/u.test(charAt(source, index + 1) ?? '');
}

/** `WBe`: character before the closing `$` is an uppercase currency code. */
function currencyBeforeClose(source: string, index: number): boolean {
  if (!isUppercase(source[index - 1])) return false;
  let start = index - 1;
  while (start > 0 && isUppercase(source[start - 1])) start--;
  return CURRENCY_CODES_RE.test(source.slice(start, index))
    ? true
    : index - start <= 2 && !/[\p{L}\p{Nd}]/u.test(source[start - 1] ?? '');
}

/** `jBe`: the char right after `$` is a digit, or a sign/point then a digit. */
function nextIsSignOrDigit(source: string, index: number): boolean {
  const after = source[index + 1];
  return isDigit(charAt(source, index + 1))
    ? true
    : (after === '-' || after === '+' || after === '.' || after === '−' || after === '＋' || after === '－') &&
        isDigit(charAt(source, index + 2));
}

/** `UBe`: `$` sits between currency punctuation and a signed number. */
const CURRENCY_PREV_CHAR_RE = /^[-–—,，、;；:：~～(（[【/／]$/;

function currencyPunctuationOpen(source: string, index: number): boolean {
  const after = source[index + 1];
  if ((after !== '-' && after !== '+' && after !== '.') || !isDigit(charAt(source, index + 2))) return false;
  const before = source[index - 1];
  return before !== undefined && CURRENCY_PREV_CHAR_RE.test(before);
}

/** `KBe`: text shaped like a numeric expression (`5$10`, `20元10`, `100 to 200`). */
const NUMERIC_SEPARATOR_ALT = String.raw`[、,，;；:：~～\-–—至到/／\s（）()=*×＝]|和|跟|与|及|或|and|or`;

function numericExpression(text: string): boolean {
  let value = text.replace(new RegExp(String.raw`^(?:${NUMERIC_SEPARATOR_ALT})+`, 'u'), '');
  for (;;) {
    const next = value
      .replace(new RegExp(String.raw`^\p{L}+(?:${NUMERIC_SEPARATOR_ALT})+`, 'u'), '')
      .replace(/^[\p{L}][\p{L} ]*(?=\p{Nd})/u, '');
    if (next === value) break;
    value = next;
  }
  if (!/\p{Nd}/u.test(value)) return false;
  const number = String.raw`[-+]?[\p{Nd}][\p{Nd},.'’]*`;
  return new RegExp(String.raw`^${number}(?:\p{L}+)?(?:(?:${NUMERIC_SEPARATOR_ALT})+${number}(?:\p{L}+)?)*$`, 'u').test(
    value,
  );
}

/** Per-`$` classification. */
const CODE_LIKE = 1; // inside a code span / URL / `${…}` template — never math
const SUPPRESSED = 2; // price- or currency-shaped (`$5`, ` $x`, `($.5`) — not math
const CANDIDATE = 3; // may open or close a math span
const NO_CANDIDATE = -1;

/**
 * Build a matcher for one source string. `pos` is the index of a `$` in
 * `source`; `lastEnd` is the end of the previous accepted match (lets a
 * match whose closing `$` is also the next opening `$` be resumed). Mirrors
 * the reference `VBe` (cache the result per source string).
 */
export function buildInlineMathMatcher(source: string): InlineMathMatcher {
  const length = source.length;
  const dollarClass = new Uint8Array(length);
  const nextCandidate = new Int32Array(length + 1).fill(NO_CANDIDATE);
  const suppressedBefore = new Int32Array(length + 1);
  const backticksBefore = new Int32Array(length + 1);
  const opaqueRanges: Array<[number, number]> = [];
  const codeSpans: Array<[number, number]> = [];

  // Backtick runs: pair runs of equal length (markdown code spans). `$` inside
  // a paired span never opens math.
  {
    const runs: Array<[number, number]> = [];
    for (let i = 0; i < length; i++) {
      if (source[i] !== '`') continue;
      if (hasEscapingBackslash(source, i)) continue;
      let end = i + 1;
      while (end < length && source[end] === '`') end++;
      runs.push([i, end]);
      i = end - 1;
    }
    const byLength = new Map<number, number[]>();
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      const runLength = run[1] - run[0];
      const group = byLength.get(runLength);
      if (group) group.push(i);
      else byLength.set(runLength, [i]);
    }
    const consumed = new Map<number, number>();
    let i = 0;
    while (i < runs.length) {
      const run = runs[i]!;
      const runLength = run[1] - run[0];
      const group = byLength.get(runLength) ?? [];
      let offset = consumed.get(runLength) ?? 0;
      while (offset < group.length && (group[offset] ?? 0) <= i) offset++;
      consumed.set(runLength, offset);
      const partner = group[offset];
      if (partner === undefined) {
        i++;
        continue;
      }
      codeSpans.push([run[0], runs[partner]![1]]);
      i = partner + 1;
    }
  }

  // URL/domain/relative-path candidates; each scans to its natural end.
  const URL_PANIC_CHARS = new Set(' \t\n\r)。，、；：！？"<>`「」『』【】〔〕（）*—–“”‘’');
  const urlStarts: number[] = [];
  for (const match of source.matchAll(/\b(?:https?:\/\/|ftp:\/\/|mailto:|www\.)/gi)) urlStarts.push(match.index);
  for (const match of source.matchAll(
    /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,})(?=(?:\/|\?|:\d))/gi,
  )) {
    urlStarts.push(match.index);
  }
  for (const match of source.matchAll(/(?:\.{1,2})?\/[\p{L}\p{Nd}._-]+(?:\/[\p{L}\p{Nd}._-]*)*\?/gu)) {
    if (match.index === 0 || !/[\w~/.-]/.test(source[match.index - 1] ?? '')) urlStarts.push(match.index);
  }
  urlStarts.sort((a, b) => a - b);
  let lastRangeEnd = -1;
  for (const start of urlStarts) {
    if (start < lastRangeEnd) continue;
    let pos = start;
    let parens = 0;
    let brackets = 0;
    let braces = 0;
    for (; pos < length; pos++) {
      const ch = source[pos]!;
      if (ch === '(') parens++;
      else if (ch === ')') {
        if (parens === 0) break;
        parens--;
      } else if (ch === '[') brackets++;
      else if (ch === ']') {
        if (brackets === 0) break;
        brackets--;
      } else if (ch === '{') braces++;
      else if (ch === '}') {
        if (braces === 0) break;
        braces--;
      } else if (URL_PANIC_CHARS.has(ch)) break;
      else if ((ch === ',' || ch === ';' || ch === '!' || ch === '?') && !/[A-Za-z0-9$]/.test(source[pos + 1] ?? '')) break;
      else if (ch === ':' && brackets === 0 && pos > start + 7 && !/[\w/?#@~.+&=%-]/.test(source[pos + 1] ?? '')) break;
    }
    opaqueRanges.push([start, pos]);
    lastRangeEnd = pos;
  }

  // HTML tags (opening/closing/self-closing, with attributes).
  const htmlRanges: Array<[number, number]> = [];
  for (let pos = 0; pos < length; pos++) {
    if (source[pos] !== '<') continue;
    const first = source[pos + 1];
    if (first === undefined || !/[a-zA-Z/]/.test(first)) continue;
    let cursor = pos + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    const tagName = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(source.slice(cursor));
    if (!tagName) continue;
    cursor += tagName[0].length;
    const afterName = source[cursor];
    if (afterName === undefined || !/[\s/>]/.test(afterName)) continue;
    let malformedAt = NO_CANDIDATE;
    let end = NO_CANDIDATE;
    for (; cursor < length; ) {
      const ch = source[cursor]!;
      if (ch === '>') {
        end = cursor;
        break;
      }
      if (!closing && ch === '/' && source[cursor + 1] === '>') {
        end = cursor + 1;
        break;
      }
      if (!/\s/.test(ch)) {
        malformedAt = cursor;
        break;
      }
      while (cursor < length && /\s/.test(source[cursor]!)) cursor++;
      const seen = source[cursor];
      if (seen === undefined) break;
      if (seen === '>') {
        end = cursor;
        break;
      }
      if (closing) {
        malformedAt = cursor;
        break;
      }
      if (seen === '/' && source[cursor + 1] === '>') {
        end = cursor + 1;
        break;
      }
      const attrName = /^[a-zA-Z_:][\w:.-]*/.exec(source.slice(cursor));
      if (!attrName) {
        malformedAt = cursor;
        break;
      }
      cursor += attrName[0].length;
      let valueAt = cursor;
      while (valueAt < length && /\s/.test(source[valueAt]!)) valueAt++;
      if (source[valueAt] === '=') {
        for (valueAt++; valueAt < length && /\s/.test(source[valueAt]!); ) valueAt++;
        const quote = source[valueAt];
        if (quote === '"' || quote === "'") {
          const close = source.indexOf(quote, valueAt + 1);
          if (close === -1) {
            malformedAt = valueAt;
            break;
          }
          cursor = close + 1;
        } else {
          const unquoted = /^[^\s"'=<>`]+/.exec(source.slice(valueAt));
          if (!unquoted) {
            malformedAt = valueAt;
            break;
          }
          cursor = valueAt + unquoted[0].length;
        }
      }
    }
    if (end !== NO_CANDIDATE) {
      htmlRanges.push([pos, end + 1]);
      pos = end;
    } else if (malformedAt !== NO_CANDIDATE) {
      const nextLt = source.indexOf('<', pos + 1);
      pos = (nextLt !== -1 && nextLt < malformedAt ? nextLt : malformedAt) - 1;
    } else break;
  }

  // Processing instructions, comments, CDATA, DOCTYPE; then scheme and email
  // autolinks (`<https://…>`, `<a@b.com>`).
  let canPi = true;
  let canComment = true;
  let canCdata = true;
  let canDoctype = true;
  for (let pos = 0; pos < length; pos++) {
    if (source[pos] !== '<') continue;
    const first = source[pos + 1];
    let consumed = false;
    if (first === '?' && canPi) {
      const close = source.indexOf('?>', pos + 2);
      if (close === -1) canPi = false;
      else {
        htmlRanges.push([pos, close + 2]);
        pos = close + 1;
        consumed = true;
      }
    } else if (first === '!') {
      if (source[pos + 2] === '-' && source[pos + 3] === '-') {
        if (canComment) {
          const close = source.indexOf('-->', pos + 4);
          if (close === -1) canComment = false;
          else {
            htmlRanges.push([pos, close + 3]);
            pos = close + 2;
            consumed = true;
          }
        }
      } else if (source.startsWith('[CDATA[', pos + 2)) {
        if (canCdata) {
          const close = source.indexOf(']]>', pos + 9);
          if (close === -1) canCdata = false;
          else {
            htmlRanges.push([pos, close + 3]);
            pos = close + 2;
            consumed = true;
          }
        }
      } else if (canDoctype && /[A-Z]/.test(source[pos + 2] ?? '')) {
        const close = source.indexOf('>', pos + 3);
        if (close === -1) canDoctype = false;
        else {
          htmlRanges.push([pos, close + 1]);
          pos = close;
          consumed = true;
        }
      }
    }
    if (consumed) continue;
    if (first !== undefined && /[a-zA-Z]/.test(first)) {
      const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:/.exec(source.slice(pos + 1));
      if (scheme) {
        let schemaEnd = pos + 1 + scheme[0].length;
        for (; schemaEnd < length && source[schemaEnd] !== '>' && source[schemaEnd] !== '<' && !/\s/.test(source[schemaEnd]!); ) schemaEnd++;
        if (source[schemaEnd] === '>') {
          htmlRanges.push([pos, schemaEnd + 1]);
          pos = schemaEnd;
          continue;
        }
      }
    }
    if (first === undefined || !/[\w.!#$%&'*+/=?^`{|}~-]/.test(first)) continue;
    let localEnd = pos + 1;
    for (; localEnd < length && /[\w.!#$%&'*+/=?^`{|}~-]/.test(source[localEnd]!); ) localEnd++;
    if (source[localEnd] !== '@') continue;
    localEnd++;
    const domainPart = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/;
    let parsed = domainPart.exec(source.slice(localEnd));
    if (!parsed) continue;
    for (localEnd += parsed[0].length; source[localEnd] === '.' && (parsed = domainPart.exec(source.slice(localEnd + 1)), parsed !== null); ) localEnd += 1 + parsed[0].length;
    if (source[localEnd] === '>') {
      htmlRanges.push([pos, localEnd + 1]);
      pos = localEnd;
    }
  }
  htmlRanges.sort((a, b) => a[0] - b[0]);
  const mergedHtml: Array<[number, number]> = [];
  for (const range of htmlRanges) {
    const last = mergedHtml.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else mergedHtml.push([range[0], range[1]]);
  }
  opaqueRanges.push(...mergedHtml);

  // Markdown link destinations `[...](dest)` — the destination is opaque.
  const inCodeSpan = (index: number): boolean => {
    let i = 0;
    for (; i < codeSpans.length && index >= (codeSpans[i]?.[1] ?? 0); ) i++;
    const span = codeSpans[i];
    return span !== undefined && index >= span[0];
  };
  const inHtmlRange = (index: number): boolean => {
    let i = 0;
    for (; i < mergedHtml.length && index >= (mergedHtml[i]?.[1] ?? 0); ) i++;
    const range = mergedHtml[i];
    return range !== undefined && index >= range[0];
  };
  const pendingParens: number[] = [];
  let activeQuote: string | null = null;
  let bracketDepth = 0;
  let inAngleDestination = false;
  for (let pos = 0; pos < length; pos++) {
    if (source[pos] === '\\') {
      pos++;
      continue;
    }
    if (inAngleDestination) {
      if (source[pos] === '>') inAngleDestination = false;
      continue;
    }
    if (inCodeSpan(pos) || inHtmlRange(pos)) continue;
    if (activeQuote !== null) {
      if (source[pos] === activeQuote) activeQuote = null;
      continue;
    }
    if (pendingParens.length > 0 && (source[pos] === '"' || source[pos] === "'") && pos > 0 && /\s/.test(source[pos - 1] ?? '')) {
      activeQuote = source[pos]!;
    } else if (source[pos] === '[') {
      bracketDepth++;
    } else if (source[pos] === ']') {
      if (bracketDepth > 0 && source[pos + 1] === '(') {
        pendingParens.push(pos);
        inAngleDestination = source[pos + 2] === '<';
        pos++;
      }
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (source[pos] === '(' && pendingParens.length > 0) {
      pendingParens.push(-1);
    } else if (source[pos] === ')' && pendingParens.length > 0) {
      const open = pendingParens.pop();
      if (open !== undefined && open >= 0) {
        const destination = source.slice(open + 2, pos);
        const validDestination =
          /\s/.exec(destination) === null ||
          (destination.startsWith('<') && /^<(?:\\[<>]|[^<>])*>$/.test(destination)) ||
          /^[^\s]*\s+("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\(([^()\\]|\\.)*\))$/.test(destination);
        if (validDestination) opaqueRanges.push([open, pos + 1]);
      }
    }
  }
  opaqueRanges.sort((a, b) => a[0] - b[0]);
  const mergedOpaque: Array<[number, number]> = [];
  for (const range of opaqueRanges) {
    const last = mergedOpaque.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else mergedOpaque.push([range[0], range[1]]);
  }
  const inOpaqueRange = (index: number): boolean => {
    let low = 0;
    let high = mergedOpaque.length - 1;
    for (; low <= high; ) {
      const mid = (low + high) >> 1;
      const range = mergedOpaque[mid];
      if (range === undefined) return false;
      if (index < range[0]) high = mid - 1;
      else if (index >= range[1]) low = mid + 1;
      else return true;
    }
    return false;
  };

  // `$` inside a backticked `${…}` template-literal span is not math.
  const templateMarked = new Uint8Array(length);
  {
    let runStart = -1;
    let strayDollar = false;
    let inTemplate = false;
    let braceDepth = 0;
    for (let i = 0; i <= length; i++) {
      const isBacktick = i < length && source[i] === '`';
      if (i === length || isBacktick) {
        if (isBacktick && runStart !== -1 && inTemplate && !strayDollar && braceDepth === 0) {
          for (let k = runStart + 1; k < i; k++) templateMarked[k] = 1;
        }
        runStart = i;
        strayDollar = false;
        inTemplate = false;
        braceDepth = 0;
        continue;
      }
      if (runStart === -1) continue;
      const ch = source[i]!;
      if (ch === '$') {
        if (!hasEscapingBackslash(source, i)) {
          if (source[i + 1] === '{') {
            inTemplate = true;
            braceDepth++;
            i++;
          } else if (braceDepth === 0) {
            strayDollar = true;
          }
        }
      } else if (braceDepth > 0) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
    }
  }

  for (let j = 0; j < length; j++) {
    backticksBefore[j + 1] = (backticksBefore[j] ?? 0) + (source[j] === '`' && !hasEscapingBackslash(source, j) ? 1 : 0);
    if (source[j] === '$') {
      if (hasEscapingBackslash(source, j) || inOpaqueRange(j) || templateMarked[j] === 1) dollarClass[j] = CODE_LIKE;
      else if (isWhitespace(source[j - 1]) || isDigit(charAt(source, j + 1)) || currencyPunctuationOpen(source, j)) {
        dollarClass[j] = SUPPRESSED;
      } else dollarClass[j] = CANDIDATE;
    }
    suppressedBefore[j + 1] = (suppressedBefore[j] ?? 0) + (dollarClass[j] === SUPPRESSED ? 1 : 0);
  }
  let lastCandidate = NO_CANDIDATE;
  for (let j = length - 1; j >= 0; j--) {
    if (dollarClass[j] === CANDIDATE) lastCandidate = j;
    nextCandidate[j] = lastCandidate;
  }

  // What may follow a `$` that closes math.
  const AFTER_OPEN_CHAR_RE = /^[\p{L}\p{Nd}\\|{([+.¬°-±×÷′-″←-⇿∀-⋿^_<>=-]$/u;
  const ENDS_IN_NON_ALNUM_RE = /[^\p{L}\p{Nd}\s]$/u;
  const CONTAINS_EXOTIC_RE = /[^\s\u0020-\u007E\u0370-\u03FF\u{1D400}-\u{1D7FF}\p{Nd}¬°-±×÷′-″←-⇿∀-⋿]/u;
  const CONTAINS_LOWER_WORD_RE = /(?:^|\s)[a-z]{2,}/;

  /** `q`: checks at the closing `$` (its own follow-up and the next candidate). */
  const closingIsSound = (closing: number, content: string): boolean => {
    const after = charAt(source, closing + 1);
    if (after === undefined || !AFTER_OPEN_CHAR_RE.test(after)) return false;
    const next = nextCandidate[closing + 1] ?? NO_CANDIDATE;
    if (next !== NO_CANDIDATE) {
      const between = source.slice(closing + 1, next);
      const betweenLength = next - (closing + 1);
      const singleWideChar = betweenLength === ((source.codePointAt(closing + 1) ?? 0) > 0xffff ? 2 : 1);
      if ((!singleWideChar && CONTAINS_EXOTIC_RE.test(between)) || /[,;:!?]$/.test(between) || /^[a-z]{2,}$/.test(between)) {
        return false;
      }
      return (
        (suppressedBefore[next] ?? 0) - (suppressedBefore[closing + 1] ?? 0) === 0 &&
        (backticksBefore[next] ?? 0) - (backticksBefore[closing + 1] ?? 0) === 0
      );
    }
    return ENDS_IN_NON_ALNUM_RE.test(content) || CONTAINS_EXOTIC_RE.test(content) || CONTAINS_LOWER_WORD_RE.test(content);
  };

  return (pos: number, lastEnd = -1): InlineMathMatch | null => {
    if (
      source[pos] !== '$' ||
      dollarClass[pos] === CODE_LIKE ||
      source[pos + 1] === '$' ||
      (source[pos - 1] === '$' && lastEnd !== pos) ||
      currencyBeforeDollar(source, pos) ||
      pos + 1 >= length ||
      isWhitespace(charAt(source, pos + 1))
    ) {
      return null;
    }
    const closing = nextCandidate[pos + 1] ?? NO_CANDIDATE;
    if (
      closing === NO_CANDIDATE ||
      (suppressedBefore[closing] ?? 0) - (suppressedBefore[pos + 1] ?? 0) > 0 ||
      (backticksBefore[closing] ?? 0) - (backticksBefore[pos + 1] ?? 0) > 0
    ) {
      return null;
    }
    const content = source.slice(pos + 1, closing);
    const rejected =
      /^\{[A-Z_][A-Z0-9_]*(?:\}$|[:-])/.test(content) ||
      (source[closing + 1] === '{' && /^\{[A-Za-z_][A-Za-z0-9_]*(?:[:-][^{}]*)?\}$/.test(content)) ||
      (isDigit(prevChar(source, pos)) && numericExpression(content)) ||
      (nextIsSignOrDigit(source, pos) &&
        (closingIsSound(closing, content) ||
          currencyBeforeClose(source, closing) ||
          (/\s/.test(content) && /\p{Nd}$/u.test(content) && !/[+\-*/^=_<>|\\¬°-±×÷′-″←-⇿∀-⋿]/.test(content)) ||
          false)) ||
      (source[closing + 1] === '$' && !/\p{L}/u.test(content) && ENDS_IN_NON_ALNUM_RE.test(content));
    return rejected ? null : { content, end: closing + 1 };
  };
}