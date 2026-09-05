import { describe, expect, it } from 'vitest';

import {
  DsmlStreamParser,
  extractDsmlToolCalls,
} from '#/kosong/provider/bases/openai/dsml-tool-parser';
import { OpenAILegacyChatProvider } from '#/kosong/provider/bases/openai/openai-legacy';

describe('agent-core-v2: DsmlStreamParser and extractDsmlToolCalls', () => {
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

  describe('OpenAILegacyChatProvider DSML integration', () => {
    it('parses streamed DSML tool calls from delta.content and sets finishReason to tool_calls', async () => {
      const provider = new OpenAILegacyChatProvider({
        model: 'deepseek-chat',
        apiKey: 'test-key',
        stream: true,
      });

      async function* mockStream(chunks: unknown[]) {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      const chunks = [
        {
          id: 'chatcmpl-v2-1',
          choices: [
            {
              index: 0,
              delta: {
                content:
                  'Reading the code.\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="filePath" string="true">src/server.ts</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>',
              },
              finish_reason: 'stop',
            },
          ],
        },
      ];

      (provider as unknown as { _client: unknown })._client = {
        chat: {
          completions: {
            create: () => ({
              withResponse: async () => ({
                data: mockStream(chunks),
                response: { headers: new Headers() },
              }),
            }),
          },
        },
      };

      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);

      expect(stream.finishReason).toBe('tool_calls');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({
        type: 'text',
        text: 'Reading the code.\n\n',
      });
      expect(parts[1]).toMatchObject({
        type: 'function',
        name: 'Read',
        arguments: '{"filePath":"src/server.ts"}',
      });
    });

    it('parses non-streamed DSML tool calls and sets finishReason to tool_calls', async () => {
      const provider = new OpenAILegacyChatProvider({
        model: 'deepseek-chat',
        apiKey: 'test-key',
        stream: false,
      });

      const responseData = {
        id: 'chatcmpl-v2-nonstream',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Glob">\n<｜DSML｜parameter name="pattern" string="true">*.json</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>',
            },
            finish_reason: 'stop',
          },
        ],
      };

      (provider as unknown as { _client: unknown })._client = {
        chat: {
          completions: {
            create: () => ({
              withResponse: async () => ({
                data: responseData,
                response: { headers: new Headers() },
              }),
            }),
          },
        },
      };

      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);

      expect(stream.finishReason).toBe('tool_calls');
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        type: 'function',
        name: 'Glob',
        arguments: '{"pattern":"*.json"}',
      });
    });

    function mockClientFor(stream: unknown): unknown {
      return {
        chat: {
          completions: {
            create: () => ({
              withResponse: async () => ({ data: stream, response: { headers: new Headers() } }),
            }),
          },
        },
      };
    }

    async function* chunksOf(chunks: unknown[]) {
      for (const chunk of chunks) yield chunk;
    }

    const DSML_ECHO =
      '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="filePath" string="true">src/server.ts</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>';

    it('lets native streamed tool calls win over a DSML echo in content', async () => {
      const provider = new OpenAILegacyChatProvider({ model: 'deepseek-chat', apiKey: 'k', stream: true });
      const chunks = [
        { id: 'c1', choices: [{ index: 0, delta: { content: DSML_ECHO }, finish_reason: null }] },
        {
          id: 'c1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_native', type: 'function', function: { name: 'Read', arguments: '{"filePath":"src/server.ts"}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ];
      (provider as unknown as { _client: unknown })._client = mockClientFor(chunksOf(chunks));
      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);
      const calls = parts.filter((p) => p['type'] === 'function');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ id: 'call_native', name: 'Read' });
      expect(stream.finishReason).toBe('tool_calls');
    });

    it('keeps intentional repeated native streamed calls distinct', async () => {
      const provider = new OpenAILegacyChatProvider({ model: 'deepseek-chat', apiKey: 'k', stream: true });
      const native = (id: string, index: number) => ({
        index,
        id,
        type: 'function',
        function: { name: 'Read', arguments: '{"filePath":"a.ts"}' },
      });
      const chunks = [
        { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [native('call_a', 0)] }, finish_reason: null }] },
        { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [native('call_b', 1)] }, finish_reason: 'tool_calls' }] },
      ];
      (provider as unknown as { _client: unknown })._client = mockClientFor(chunksOf(chunks));
      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);
      expect(parts.filter((p) => p['type'] === 'function').map((p) => p['id'])).toEqual(['call_a', 'call_b']);
    });

    it('defers recovered streamed calls until the response ends so a late native call can win', async () => {
      const provider = new OpenAILegacyChatProvider({ model: 'deepseek-chat', apiKey: 'k', stream: true });
      const chunks = [
        { id: 'c1', choices: [{ index: 0, delta: { content: 'Reading.\n' + DSML_ECHO }, finish_reason: null }] },
        { id: 'c1', choices: [{ index: 0, delta: { content: '\nDone.' }, finish_reason: 'stop' }] },
      ];
      (provider as unknown as { _client: unknown })._client = mockClientFor(chunksOf(chunks));
      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);
      expect(parts.map((p) => p['type'])).toEqual(['text', 'text', 'function']);
      expect(stream.finishReason).toBe('tool_calls');
    });

    it('ignores a DSML echo in non-stream content when native tool calls are present', async () => {
      const provider = new OpenAILegacyChatProvider({ model: 'deepseek-chat', apiKey: 'k', stream: false });
      const responseData = {
        id: 'n1',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: DSML_ECHO,
              tool_calls: [
                { id: 'call_native', type: 'function', function: { name: 'Read', arguments: '{"filePath":"src/server.ts"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };
      (provider as unknown as { _client: unknown })._client = mockClientFor(responseData);
      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);
      const calls = parts.filter((p) => p['type'] === 'function');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ id: 'call_native' });
      expect(parts.filter((p) => p['type'] === 'text').map((p) => p['text'])).toEqual([DSML_ECHO]);
    });

    it('preserves surrounding whitespace and markdown hard breaks in non-stream response', async () => {
      const provider = new OpenAILegacyChatProvider({
        model: 'deepseek-chat',
        apiKey: 'test-key',
        stream: false,
      });

      const textWithWhitespace = '  Line 1  \nLine 2  ';
      const responseData = {
        id: 'chatcmpl-v2-whitespace',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: textWithWhitespace,
            },
            finish_reason: 'stop',
          },
        ],
      };

      (provider as unknown as { _client: unknown })._client = {
        chat: {
          completions: {
            create: () => ({
              withResponse: async () => ({
                data: responseData,
                response: { headers: new Headers() },
              }),
            }),
          },
        },
      };

      const stream = await provider.generate('', [], []);
      const parts: Array<Record<string, unknown>> = [];
      for await (const p of stream) parts.push(p as unknown as Record<string, unknown>);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({
        type: 'text',
        text: textWithWhitespace,
      });
    });

    it('preserves malformed invoke block as text without discarding content', () => {
      const input = '<｜DSML｜invoke>malformed content without name</｜DSML｜invoke>';
      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe(input);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('preserves malformed Hermes block as text without discarding content', () => {
      const input = '<tool_call>not valid json</tool_call>';
      const result = extractDsmlToolCalls(input);
      expect(result.cleanText).toBe(input);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('handles stream split after whitespace in tag prefix', () => {
      const parser = new DsmlStreamParser();
      const chunks = [
        '< ',
        '| DSML ',
        '| invoke name="Read">\n< | DSML | parameter name="filePath">src/app.ts</ | DSML | parameter>\n</ | DSML | invoke>',
      ];

      const parts = [];
      for (const chunk of chunks) {
        parts.push(...parser.feed(chunk));
      }
      parts.push(...parser.flush());

      expect(parser.hasExtractedToolCalls).toBe(true);
      const toolParts = parts.filter((p) => p.type === 'function');
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0]?.name).toBe('Read');
    });

    it('preserves unclosed Hermes block at flush as text', () => {
      const parser = new DsmlStreamParser();
      const parts = [
        ...parser.feed('<tool_call>{"name": "Read"}'),
        ...parser.flush(),
      ];

      expect(parser.hasExtractedToolCalls).toBe(false);
      expect(parts).toEqual([
        { type: 'text', text: '<tool_call>{"name": "Read"}' },
      ]);
    });
  });
});
