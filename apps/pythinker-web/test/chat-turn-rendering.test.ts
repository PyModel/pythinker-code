import { describe, expect, it } from 'vitest';
import type { ChatTurn, ToolCall, TurnBlock } from '../src/types';
import {
  assistantRenderBlocks,
  foldRenderBlocks,
  formatDuration,
  formatLiveDuration,
  formatTokens,
  rendersToolCard,
  renderBlockKey,
  toolStackPosition,
  turnBlocks,
  turnFinalText,
  turnToMarkdown,
} from '../src/components/chatTurnRendering';

function tool(id: string, over: Partial<ToolCall> = {}): ToolCall {
  return { id, name: 'read', arg: `· ${id}.ts`, status: 'ok', ...over };
}

function toolBlock(id: string, over: Partial<ToolCall> = {}): Extract<TurnBlock, { kind: 'tool' }> {
  return { kind: 'tool', tool: tool(id, over) };
}

function assistantTurn(blocks: TurnBlock[], over: Partial<ChatTurn> = {}): ChatTurn {
  return { id: 't1', role: 'assistant', no: 1, text: '', blocks, ...over };
}

describe('formatTokens', () => {
  it('keeps counts under 1024 verbatim and uses 1024-based k / M units', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1000');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(1_000_000)).toBe('977k');
    expect(formatTokens(2_500_000)).toBe('2.4M');
  });
});

describe('formatDuration', () => {
  it('switches units at the 1s and 1m boundaries', () => {
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(59_999)).toBe('60.0s');
    expect(formatDuration(60_000)).toBe('1m0.0s');
    expect(formatDuration(90_500)).toBe('1m30.5s');
  });
});

describe('formatLiveDuration', () => {
  it('formats whole-second compact durations like the reference live timer', () => {
    expect(formatLiveDuration(0)).toBe('');
    expect(formatLiveDuration(500)).toBe('');
    expect(formatLiveDuration(45_000)).toBe('45s');
    expect(formatLiveDuration(60_000)).toBe('1m');
    expect(formatLiveDuration(63_000)).toBe('1m3s');
    expect(formatLiveDuration(120_000)).toBe('2m');
    expect(formatLiveDuration(7_500_000)).toBe('2h5m');
  });
});

describe('turnBlocks', () => {
  it('returns the ordered blocks as-is when present', () => {
    const blocks: TurnBlock[] = [{ kind: 'text', text: 'hi' }];
    expect(turnBlocks(assistantTurn(blocks))).toBe(blocks);
  });

  it('falls back to thinking -> text -> tools order when blocks are absent', () => {
    const turn: ChatTurn = {
      id: 't1',
      role: 'assistant',
      no: 1,
      text: 'answer',
      thinking: 'plan',
      tools: [tool('a')],
    };
    expect(turnBlocks(turn)).toEqual([
      { kind: 'thinking', thinking: 'plan' },
      { kind: 'text', text: 'answer' },
      { kind: 'tool', tool: tool('a') },
    ]);
  });
});

describe('rendersToolCard', () => {
  it('hides the card only for a successful tool that carries inline media', () => {
    expect(rendersToolCard(toolBlock('a'))).toBe(true);
    expect(rendersToolCard(toolBlock('r', { status: 'running' }))).toBe(true);
    expect(
      rendersToolCard(toolBlock('m', { status: 'ok', media: { kind: 'image', url: 'x' } })),
    ).toBe(false);
    // media but errored -> still rendered as a card
    expect(
      rendersToolCard(toolBlock('e', { status: 'error', media: { kind: 'image', url: 'x' } })),
    ).toBe(true);
  });
});

describe('toolStackPosition', () => {
  it('marks a lone tool single and otherwise reports first/middle/last', () => {
    expect(toolStackPosition(0, 1)).toBe('single');
    expect(toolStackPosition(0, 0)).toBe('single');
    expect(toolStackPosition(0, 3)).toBe('first');
    expect(toolStackPosition(1, 3)).toBe('middle');
    expect(toolStackPosition(2, 3)).toBe('last');
  });
});

describe('assistantRenderBlocks', () => {
  it('folds consecutive renderable tools into one activity-run', () => {
    const rendered = assistantRenderBlocks(assistantTurn([toolBlock('a'), toolBlock('b')]));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ kind: 'activity-run' });
    if (rendered[0]?.kind === 'activity-run') {
      expect(rendered[0].items.map((t) => t.tool.id)).toEqual(['a', 'b']);
      expect(rendered[0].items.map((t) => t.sourceIndex)).toEqual([0, 1]);
    }
  });

  it('folds thinking segments into the same run as following tools', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([{ kind: 'thinking', thinking: 'plan' }, toolBlock('a'), toolBlock('b')]),
    );
    expect(rendered[0]?.kind).toBe('activity-run');
    expect(rendered).toHaveLength(1);
  });

  it('flattens a turn block that already carries an activity-run (parity)', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([
        { kind: 'activity-run', items: [{ kind: 'thinking', thinking: 'a' }, toolBlock('b')] },
        toolBlock('c'),
      ]),
    );
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.kind).toBe('activity-run');
  });

  it('renders a lone tool as a standalone tool, not a run', () => {
    const rendered = assistantRenderBlocks(assistantTurn([toolBlock('a')]));
    expect(rendered).toEqual([{ kind: 'tool', tool: tool('a'), sourceIndex: 0 }]);
  });

  it('breaks the run when a non-tool block interrupts', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([toolBlock('a'), { kind: 'text', text: 'x' }, toolBlock('b')]),
    );
    expect(rendered.map((b) => b.kind)).toEqual(['tool', 'text', 'tool']);
  });

  it('breaks the run when a media tool (no card) interrupts', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([
        toolBlock('a'),
        toolBlock('b'),
        toolBlock('c', { status: 'ok', media: { kind: 'image', url: 'x' } }),
      ]),
    );
    expect(rendered.map((b) => b.kind)).toEqual(['activity-run', 'tool']);
    if (rendered[0]?.kind === 'activity-run') {
      expect(rendered[0].items.map((t) => t.tool.id)).toEqual(['a', 'b']);
    }
  });

  it('does not emit an empty text block and it still breaks the run', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([{ kind: 'thinking', thinking: 'plan' }, { kind: 'text', text: '' }, toolBlock('a')]),
    );
    expect(rendered.map((b) => b.kind)).toEqual(['thinking', 'tool']);
  });

  it('preserves thinking/text order with their source indexes', () => {
    const rendered = assistantRenderBlocks(
      assistantTurn([
        { kind: 'thinking', thinking: 'plan' },
        { kind: 'text', text: 'answer' },
      ]),
    );
    expect(rendered).toEqual([
      { kind: 'thinking', thinking: 'plan', sourceIndex: 0 },
      { kind: 'text', text: 'answer', sourceIndex: 1 },
    ]);
  });
});

describe('foldRenderBlocks', () => {
  it('folds thinking and tools before the last non-blank text block', () => {
    const blocks = assistantRenderBlocks(
      assistantTurn([
        { kind: 'thinking', thinking: 'plan' },
        toolBlock('a'),
        { kind: 'text', text: 'answer' },
      ]),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['activity-run', 'text']);
    expect(foldRenderBlocks(blocks)).toEqual({
      folded: blocks.slice(0, 1),
      visible: blocks.slice(1),
    });
  });

  it('folds every block in an all-tools turn', () => {
    const blocks = assistantRenderBlocks(assistantTurn([toolBlock('a'), toolBlock('b')]));
    expect(foldRenderBlocks(blocks)).toEqual({ folded: blocks, visible: [] });
  });

  it('keeps a leading text block and following tools visible', () => {
    const blocks = assistantRenderBlocks(
      assistantTurn([{ kind: 'text', text: 'answer' }, toolBlock('a')]),
    );
    expect(foldRenderBlocks(blocks)).toEqual({ folded: [], visible: blocks });
  });

  it('does not use blank text blocks as anchors', () => {
    const blocks = assistantRenderBlocks(
      assistantTurn([toolBlock('a'), { kind: 'text', text: '  \n ' }]),
    );
    expect(foldRenderBlocks(blocks)).toEqual({ folded: blocks, visible: [] });
  });
});

describe('turnFinalText', () => {
  it('joins only the text blocks, dropping thinking and tools', () => {
    const turn = assistantTurn([
      { kind: 'thinking', thinking: 'plan' },
      { kind: 'text', text: 'first' },
      toolBlock('a'),
      { kind: 'text', text: 'second' },
    ]);
    expect(turnFinalText(turn)).toBe('first\n\nsecond');
  });
});

describe('turnToMarkdown', () => {
  it('renders thinking as a quote, text verbatim, and tool output as a fenced block', () => {
    const turn = assistantTurn([
      { kind: 'thinking', thinking: 'line1\nline2' },
      { kind: 'text', text: 'hello' },
      toolBlock('a', { name: 'bash', output: ['out1', 'out2'] }),
    ]);
    expect(turnToMarkdown(turn)).toBe(
      ['> **Thinking**\n> line1\n> line2', 'hello', '```\n[bash]\nout1\nout2\n```'].join('\n\n'),
    );
  });
});

describe('renderBlockKey', () => {
  it('derives stable keys per block kind', () => {
    expect(renderBlockKey({ kind: 'text', text: 'x', sourceIndex: 2 }, 0)).toBe('text-2');
    expect(renderBlockKey({ kind: 'tool', tool: tool('a'), sourceIndex: 3 }, 0)).toBe('a');
    expect(
      renderBlockKey({ kind: 'tool-stack', tools: [{ tool: tool('a'), sourceIndex: 5 }] }, 0),
    ).toBe('tool-stack-5');
    expect(
      renderBlockKey(
        { kind: 'activity-run', items: [{ kind: 'thinking', thinking: 'a', sourceIndex: 7 }] },
        0,
      ),
    ).toBe('activity-run-7');
  });
});
