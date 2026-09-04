import { describe, expect, it } from 'vitest';

import {
  DsmlStreamParser,
  extractDsmlToolCalls,
} from '#/providers/dsml-tool-parser';

describe('DsmlStreamParser and extractDsmlToolCalls', () => {
  describe('extractDsmlToolCalls', () => {
    it('extracts standard DeepSeek DSML tool calls with fullwidth bars', () => {
      const input = `I will read the file.
<｜DSML｜tool_calls>
<｜DSML｜invoke name="Read">
<｜DSML｜parameter name="filePath" string="true">src/index.ts</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe('I will read the file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('Read');
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        filePath: 'src/index.ts',
      });
      expect(result.toolCalls[0]?.id).toMatch(/^call_/);
    });

    it('extracts DSML tool calls with standard ASCII pipes', () => {
      const input = `<|DSML|tool_calls>
<|DSML|invoke name="Glob">
<|DSML|parameter name="pattern" string="true">**/*.ts</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`;

      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('Glob');
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        pattern: '**/*.ts',
      });
    });

    it('extracts multiple invokes with mixed typed parameters', () => {
      const input = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="Search">
<｜DSML｜parameter name="query" string="true">export function</｜DSML｜parameter>
<｜DSML｜parameter name="limit" string="false">25</｜DSML｜parameter>
<｜DSML｜parameter name="caseSensitive" string="false">true</｜DSML｜parameter>
<｜DSML｜parameter name="filter" string="false">{"type": "code"}</｜DSML｜parameter>
</｜DSML｜invoke>
<｜DSML｜invoke name="Read">
<｜DSML｜parameter name="path">src/main.ts</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe('');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]?.name).toBe('Search');
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        query: 'export function',
        limit: 25,
        caseSensitive: true,
        filter: { type: 'code' },
      });
      expect(result.toolCalls[1]?.name).toBe('Read');
      expect(JSON.parse(result.toolCalls[1]?.arguments ?? '{}')).toEqual({
        path: 'src/main.ts',
      });
    });

    it('extracts invoke without container tag', () => {
      const input = `Checking directory:
<｜DSML｜invoke name="ListDir">
<｜DSML｜parameter name="dir" string="true">packages</｜DSML｜parameter>
</｜DSML｜invoke>`;

      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe('Checking directory:');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('ListDir');
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        dir: 'packages',
      });
    });

    it('extracts Hermes tool_call JSON format', () => {
      const input = `<tool_call>
{"name": "Read", "arguments": {"filePath": "package.json"}}
</tool_call>`;

      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('Read');
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        filePath: 'package.json',
      });
    });

    it('decodes XML entities in parameter values', () => {
      const input = `<｜DSML｜invoke name="Eval">
<｜DSML｜parameter name="code" string="true">a &amp;&amp; b &lt; c</｜DSML｜parameter>
</｜DSML｜invoke>`;

      const result = extractDsmlToolCalls(input);
      expect(result.toolCalls).toHaveLength(1);
      expect(JSON.parse(result.toolCalls[0]?.arguments ?? '{}')).toEqual({
        code: 'a && b < c',
      });
    });

    it('preserves regular non-tool tags and operators in text', () => {
      const input = 'Check if 5 < 10 and 20 > 15, or use <div>Hello</div> and vector<int>.';
      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe(input);
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('DsmlStreamParser', () => {
    it('streams normal text without modification', () => {
      const parser = new DsmlStreamParser();
      const parts = [
        ...parser.feed('Hello world! '),
        ...parser.feed('How are you today?'),
        ...parser.flush(),
      ];

      expect(parts).toEqual([
        { type: 'text', text: 'Hello world! ' },
        { type: 'text', text: 'How are you today?' },
      ]);
      expect(parser.hasExtractedToolCalls).toBe(false);
    });

    it('handles stream split across DSML container and invoke chunks', () => {
      const parser = new DsmlStreamParser();
      const chunks = [
        'Looking into the code...\n\n',
        '<',
        '｜DSML',
        '｜tool_calls>\n',
        '<｜DSML｜invoke name="Read">\n',
        '<｜DSML｜parameter name="filePath" ',
        'string="true">src/app.ts',
        '</｜DSML｜parameter>\n',
        '</｜DSML｜invoke>\n',
        '</｜DSML｜tool_calls>\n',
        'Done reading.',
      ];

      const parts = [];
      for (const chunk of chunks) {
        parts.push(...parser.feed(chunk));
      }
      parts.push(...parser.flush());

      expect(parser.hasExtractedToolCalls).toBe(true);

      const textParts = parts.filter((p) => p.type === 'text');
      const toolParts = parts.filter((p) => p.type === 'function');

      expect(textParts.map((p) => p.text).join('')).toBe(
        'Looking into the code...\n\nDone reading.',
      );
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0]?.name).toBe('Read');
      expect(JSON.parse(toolParts[0]?.arguments ?? '{}')).toEqual({
        filePath: 'src/app.ts',
      });
    });

    it('correctly flushes partial code comparisons that look like tags', () => {
      const parser = new DsmlStreamParser();
      const parts = [
        ...parser.feed('if (x <'),
        ...parser.feed(' 5 && y > 2)'),
        ...parser.flush(),
      ];

      const fullText = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      expect(fullText).toBe('if (x < 5 && y > 2)');
      expect(parser.hasExtractedToolCalls).toBe(false);
    });
  });
});
