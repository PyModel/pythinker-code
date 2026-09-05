import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StreamedMessagePart } from '#/kosong/contract/message';
import {
  DSML_MAX_ENVELOPE_CHARS,
  DSML_MAX_TAG_CHARS,
  DsmlStreamParser,
  extractDsmlToolCalls,
  parseInvokeBody,
} from '#/kosong/provider/bases/openai/dsml-tool-parser';

interface Normalized {
  text: string;
  calls: Array<{ name: string; arguments: string }>;
}

function normalize(parts: StreamedMessagePart[]): Normalized {
  const calls: Normalized['calls'] = [];
  let text = '';
  for (const part of parts) {
    if (part.type === 'function') calls.push({ name: part.name, arguments: part.arguments ?? '' });
    else if (part.type === 'text') text += part.text;
  }
  return { text, calls };
}

function runChunks(chunks: string[]): Normalized {
  const parser = new DsmlStreamParser();
  const parts: StreamedMessagePart[] = [];
  for (const chunk of chunks) parts.push(...parser.feed(chunk));
  parts.push(...parser.flush());
  return normalize(parts);
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomPartition(input: string, random: () => number): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < input.length) {
    const size = 1 + Math.floor(random() * 12);
    chunks.push(input.slice(pos, pos + size));
    pos += size;
  }
  return chunks;
}

const DSML_CALL =
  '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="filePath" string="true">src/app.ts</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>';

const CORPUS: Record<string, string> = {
  plainText: 'Check if 5 < 10 and 20 > 15, or use <div>Hello</div> and vector<int>.',
  singleCall: `Looking into the code...\n\n${DSML_CALL}\nDone reading.`,
  asciiBars:
    '<|DSML|tool_calls>\n<|DSML|invoke name="Glob">\n<|DSML|parameter name="pattern" string="true">**/*.ts</|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>',
  spacedMarkers:
    '< | DSML | invoke name="Read">\n< | DSML | parameter name="filePath">src/app.ts</ | DSML | parameter>\n</ | DSML | invoke>',
  twoInvokes:
    '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Search">\n<｜DSML｜parameter name="query" string="true">export function</｜DSML｜parameter>\n<｜DSML｜parameter name="limit" string="false">25</｜DSML｜parameter>\n</｜DSML｜invoke>\n<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="path">src/main.ts</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>',
  bareInvoke:
    'Checking directory:\n<｜DSML｜invoke name="ListDir">\n<｜DSML｜parameter name="dir" string="true">packages</｜DSML｜parameter>\n</｜DSML｜invoke>',
  jsonBody: '<｜DSML｜invoke name="Eval">{"code":"a < b && c > d"}</｜DSML｜invoke>',
  hermes: 'Sure.\n<tool_call>\n{"name": "Read", "arguments": {"filePath": "package.json"}}\n</tool_call>\n',
  hermesUnclosed: '<tool_call>{"name": "Read"}',
  malformedInvoke: 'before <｜DSML｜invoke>malformed content without name</｜DSML｜invoke> after',
  malformedBody: 'x <｜DSML｜invoke name="noop">definitely not JSON or parameters</｜DSML｜invoke> y',
  containerNoCalls: 'before <tool_calls>not a call</tool_calls> after',
  containerOnlyText: '<｜DSML｜tool_calls>\nplain prose\n</｜DSML｜tool_calls>',
  unclosedContainer: 'a <｜DSML｜tool_calls>\nb',
  fencedDoc:
    'Example only. Do not execute:\n```xml\n<｜DSML｜invoke name="noop">{"value":"documentation"}</｜DSML｜invoke>\n```\nEnd.',
  fencedThenReal: `Use this syntax:\n\`\`\`\n${DSML_CALL}\n\`\`\`\nNow for real:\n${DSML_CALL}`,
  tildeFence: '~~~\n<tool_call>{"name":"Read","arguments":{}}</tool_call>\n~~~\n',
  unmarkedInvokeOutsideContainer:
    'Do not execute:\n<invoke name="noop">{"value":"documentation"}</invoke>\n',
  unmarkedInvokeInsideContainer:
    '<tool_calls>\n<invoke name="Read">\n<parameter name="filePath">a.ts</parameter>\n</invoke>\n</tool_calls>',
  entities:
    '<｜DSML｜invoke name="Eval">\n<｜DSML｜parameter name="code" string="true">a &amp;&amp; b &lt; c</｜DSML｜parameter>\n</｜DSML｜invoke>',
  codeComparison: 'if (x < 5 && y > 2) { return a <b; }',
  whitespaceAfterTags: `${DSML_CALL}\n\n\nTrailing paragraph.`,
  crlf: DSML_CALL.replaceAll('\n', '\r\n'),
  prefixLookalikes: '<d <ds <dsm <｜ </ <p <inv <tool_cal <invoked> <tool_calls_extra>',
  multibyte: `café ✓ ${DSML_CALL} \u65E5\u672C\u8A9E 😀 done`,
  strayClose: 'no container here </｜DSML｜tool_calls> still text',
  emptyInvoke: '<｜DSML｜invoke name="Noop"></｜DSML｜invoke>',
  whitespaceInvoke: '<｜DSML｜invoke name="Noop">\n   \n</｜DSML｜invoke>',
};

describe('DsmlStreamParser conformance', () => {
  describe('chunk invariance', () => {
    for (const [name, input] of Object.entries(CORPUS)) {
      it(`${name}: every two-way split equals the unsplit result`, () => {
        const whole = runChunks([input]);
        for (let offset = 1; offset < input.length; offset += 1) {
          const split = runChunks([input.slice(0, offset), input.slice(offset)]);
          expect(split, `split at ${offset}`).toEqual(whole);
        }
      });

      it(`${name}: character-at-a-time equals the unsplit result`, () => {
        const whole = runChunks([input]);
        expect(runChunks(Array.from(input))).toEqual(whole);
      });

      it(`${name}: seeded random partitions equal the unsplit result`, () => {
        const whole = runChunks([input]);
        const random = seeded(name.length * 7919 + input.length);
        for (let round = 0; round < 25; round += 1) {
          const chunks = randomPartition(input, random);
          expect(runChunks(chunks), chunks.join('|')).toEqual(whole);
        }
      });
    }

    it('handles a UTF-16 surrogate pair split between chunks', () => {
      const input = `😀 ${DSML_CALL} 😀`;
      const whole = runChunks([input]);
      expect(runChunks([input.slice(0, 1), input.slice(1)])).toEqual(whole);
      expect(runChunks([input.slice(0, input.length - 1), input.slice(-1)])).toEqual(whole);
    });
  });

  describe('streaming and non-streaming parity', () => {
    for (const [name, input] of Object.entries(CORPUS)) {
      it(`${name}: streamed text matches extractDsmlToolCalls`, () => {
        const streamed = runChunks(Array.from(input));
        const extracted = extractDsmlToolCalls(input);
        expect(extracted.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments }))).toEqual(
          streamed.calls,
        );
        if (streamed.calls.length === 0) {
          expect(extracted.cleanText).toBe(input);
          expect(streamed.text).toBe(input);
        } else {
          expect(extracted.cleanText).toBe(streamed.text.trim());
        }
      });
    }
  });

  describe('literal documentation stays text', () => {
    it('does not promote a fenced DSML example to a tool call', () => {
      const result = extractDsmlToolCalls(CORPUS['fencedDoc'] as string);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.cleanText).toBe(CORPUS['fencedDoc']);
    });

    it('does not promote a fenced Hermes example to a tool call', () => {
      const result = extractDsmlToolCalls(CORPUS['tildeFence'] as string);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.cleanText).toBe(CORPUS['tildeFence']);
    });

    it('does not promote an unmarked invoke outside a container', () => {
      const result = extractDsmlToolCalls(CORPUS['unmarkedInvokeOutsideContainer'] as string);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.cleanText).toBe(CORPUS['unmarkedInvokeOutsideContainer']);
    });

    it('accepts an unmarked invoke inside a container', () => {
      const result = extractDsmlToolCalls(CORPUS['unmarkedInvokeInsideContainer'] as string);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('Read');
      expect(result.cleanText).toBe('');
    });

    it('parses the real call that follows a fenced example', () => {
      const result = extractDsmlToolCalls(CORPUS['fencedThenReal'] as string);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.cleanText).toBe(`Use this syntax:\n\`\`\`\n${DSML_CALL}\n\`\`\`\nNow for real:`);
    });

    it('resumes recognition after the fence closes', () => {
      const input = '```\n<tool_call>{"name":"A"}</tool_call>\n```\n<tool_call>{"name":"B","arguments":{}}</tool_call>';
      const result = extractDsmlToolCalls(input);
      expect(result.toolCalls.map((c) => c.name)).toEqual(['B']);
    });
  });

  describe('invoke body validation', () => {
    it('rejects malformed nonempty bodies instead of producing empty arguments', () => {
      const result = extractDsmlToolCalls(CORPUS['malformedBody'] as string);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.cleanText).toBe(CORPUS['malformedBody']);
    });

    it('accepts an empty body as empty arguments', () => {
      expect(extractDsmlToolCalls(CORPUS['emptyInvoke'] as string).toolCalls[0]?.arguments).toBe('{}');
      expect(extractDsmlToolCalls(CORPUS['whitespaceInvoke'] as string).toolCalls[0]?.arguments).toBe(
        '{}',
      );
    });

    it('rejects prose mixed between parameter blocks', () => {
      const input =
        '<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="a">1</｜DSML｜parameter>\nstray prose\n</｜DSML｜invoke>';
      expect(extractDsmlToolCalls(input).toolCalls).toHaveLength(0);
    });

    it('rejects unnamed parameters, unclosed parameters, arrays and scalars', () => {
      expect(parseInvokeBody('<parameter>1</parameter>')).toBeNull();
      expect(parseInvokeBody('<parameter name="a">1')).toBeNull();
      expect(parseInvokeBody('[1,2]')).toBeNull();
      expect(parseInvokeBody('42')).toBeNull();
      expect(parseInvokeBody('{"a":')).toBeNull();
    });

    it('lets the last duplicate parameter win', () => {
      const body = '<parameter name="a">1</parameter><parameter name="a">2</parameter>';
      expect(parseInvokeBody(body)).toEqual({ a: 2 });
    });

    it('preserves reserved keys as own properties without touching the global prototype', () => {
      const input =
        '<｜DSML｜invoke name="noop"><｜DSML｜parameter name="__proto__" string="false">{"value":"kept"}</｜DSML｜parameter><｜DSML｜parameter name="constructor">c</｜DSML｜parameter><｜DSML｜parameter name="prototype">p</｜DSML｜parameter><｜DSML｜parameter name="normal">ok</｜DSML｜parameter></｜DSML｜invoke>';
      const result = extractDsmlToolCalls(input);
      expect(result.toolCalls).toHaveLength(1);
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual(
        JSON.parse('{"__proto__":{"value":"kept"},"constructor":"c","prototype":"p","normal":"ok"}'),
      );
      expect(result.toolCalls[0]?.arguments).toContain('"__proto__":{"value":"kept"}');
      expect(({} as Record<string, unknown>)['value']).toBeUndefined();
    });

    it('keeps reserved keys from JSON bodies', () => {
      const args = parseInvokeBody('{"__proto__":{"x":1},"y":2}');
      expect(JSON.stringify(args)).toBe('{"__proto__":{"x":1},"y":2}');
    });
  });

  describe('text preservation', () => {
    it('keeps container tags when the container yields no call', () => {
      const streamed = runChunks([CORPUS['containerNoCalls'] as string]);
      expect(streamed).toEqual({ text: CORPUS['containerNoCalls'], calls: [] });
    });

    it('drops container tags once a call is accepted and keeps later text', () => {
      const streamed = runChunks([CORPUS['singleCall'] as string]);
      expect(streamed.text).toBe('Looking into the code...\n\nDone reading.');
      expect(streamed.calls).toEqual([{ name: 'Read', arguments: '{"filePath":"src/app.ts"}' }]);
    });

    it('emits held text in order when a container has an invalid block then a valid call', () => {
      const input = `<｜DSML｜tool_calls>\n<｜DSML｜invoke>bad</｜DSML｜invoke>\n<｜DSML｜invoke name="Ok"></｜DSML｜invoke>\n</｜DSML｜tool_calls>`;
      const parser = new DsmlStreamParser();
      const parts = [...parser.feed(input), ...parser.flush()];
      expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'function']);
      expect(normalize(parts).text).toBe('<｜DSML｜invoke>bad</｜DSML｜invoke>\n');
    });

    it('preserves an unclosed container at flush', () => {
      expect(runChunks([CORPUS['unclosedContainer'] as string])).toEqual({
        text: CORPUS['unclosedContainer'],
        calls: [],
      });
    });
  });

  describe('resource budgets', () => {
    it('stops holding a tag prefix beyond the tag budget', () => {
      const input = `<invoke ${'a'.repeat(DSML_MAX_TAG_CHARS + 10)}`;
      const parser = new DsmlStreamParser();
      const parts = parser.feed(input);
      expect(normalize(parts).text).toBe(input);
    });

    it('abandons an envelope past the envelope budget and preserves the text', () => {
      const body = 'x'.repeat(DSML_MAX_ENVELOPE_CHARS + 16);
      const input = `<｜DSML｜invoke name="Big">${body}</｜DSML｜invoke>`;
      const whole = runChunks([input]);
      expect(whole.calls).toHaveLength(0);
      expect(whole.text).toBe(input);
      const random = seeded(7);
      const chunks: string[] = [];
      let pos = 0;
      while (pos < input.length) {
        const size = 1 + Math.floor(random() * 70000);
        chunks.push(input.slice(pos, pos + size));
        pos += size;
      }
      expect(runChunks(chunks)).toEqual(whole);
    });

    it('accepts an envelope exactly at the budget', () => {
      const open = '<｜DSML｜invoke name="Big">';
      const close = '</｜DSML｜invoke>';
      const body = 'x'.repeat(DSML_MAX_ENVELOPE_CHARS - open.length - close.length);
      const input = `${open}${body}${close}`;
      expect(input.length).toBe(DSML_MAX_ENVELOPE_CHARS);
      expect(runChunks([input]).calls).toHaveLength(0);
      const jsonBody = `{"v":"${'x'.repeat(DSML_MAX_ENVELOPE_CHARS - open.length - close.length - 8)}"}`;
      const valid = `${open}${jsonBody}${close}`;
      expect(valid.length).toBe(DSML_MAX_ENVELOPE_CHARS);
      expect(runChunks([valid]).calls).toHaveLength(1);
      expect(runChunks([valid.slice(0, 5000), valid.slice(5000)]).calls).toHaveLength(1);
    });

    it('scans an unclosed envelope in linear time', () => {
      const parser = new DsmlStreamParser();
      parser.feed('<｜DSML｜invoke name="Big">');
      const chunk = 'y'.repeat(64);
      const rounds = Math.floor((DSML_MAX_ENVELOPE_CHARS - 64) / 64);
      const started = performance.now();
      for (let i = 0; i < rounds; i += 1) parser.feed(chunk);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(2000);
      expect(normalize(parser.flush()).calls).toHaveLength(0);
    });
  });

  describe('implementation parity with @pymodel/kosong', () => {
    it('keeps both parser copies byte-identical except for the message import', () => {
      const dir = import.meta.dirname;
      const here = resolve(dir, '../../../src/kosong/provider/bases/openai/dsml-tool-parser.ts');
      const legacy = resolve(dir, '../../../../kosong/src/providers/dsml-tool-parser.ts');
      const v2 = readFileSync(here, 'utf8').replace(
        "from '#/kosong/contract/message';",
        "from '#/message';",
      );
      expect(readFileSync(legacy, 'utf8')).toBe(v2);
    });
  });
});
