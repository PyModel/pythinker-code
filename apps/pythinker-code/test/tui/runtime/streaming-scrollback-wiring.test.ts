/*
 * Unit coverage for the bridge's chunking and dedupe rules.
 *
 * That the streaming controller actually reaches it is proven separately, in
 * pythinker-tui-message-flow.test.ts, through the real session event path.
 */

import { describe, expect, it } from 'vitest';

import { ScrollbackBridge } from '../../../src/tui/runtime/scrollback/scrollback-bridge';

describe('ScrollbackBridge', () => {
  it('commits only whole markdown blocks while text is still growing', () => {
    const written: string[] = [];
    const bridge = new ScrollbackBridge({ sink: (text) => written.push(text) });

    bridge.begin('a1', 'turn-1');
    bridge.update('a1', '# Title');
    expect(written).toEqual([]);

    bridge.update('a1', '# Title\n\nBody so far');
    expect(written).toEqual(['# Title\n']);

    // The incomplete tail must stay out of scrollback until completion.
    bridge.update('a1', '# Title\n\nBody so far and more');
    expect(written).toEqual(['# Title\n']);

    bridge.complete('a1');
    expect(written).toEqual(['# Title\n', 'Body so far and more\n']);
  });

  it('ignores stale updates and unknown entries', () => {
    const written: string[] = [];
    const bridge = new ScrollbackBridge({ sink: (text) => written.push(text) });

    bridge.begin('a1');
    bridge.update('a1', 'hello\n\n');
    bridge.update('a1', 'hel');
    bridge.update('unknown', 'anything\n\n');
    bridge.complete('unknown');

    expect(written).toEqual(['hello\n']);
  });

  it('holds a fenced code block together across updates', () => {
    const written: string[] = [];
    const bridge = new ScrollbackBridge({ sink: (text) => written.push(text) });

    bridge.begin('a1');
    bridge.update('a1', '```ts\nconst a = 1;\n');
    bridge.update('a1', '```ts\nconst a = 1;\n\nconst b = 2;\n');
    expect(written).toEqual([]);

    bridge.update('a1', '```ts\nconst a = 1;\n\nconst b = 2;\n```\n\ntail');
    expect(written).toEqual(['```ts\nconst a = 1;\n\nconst b = 2;\n```\n']);
  });

  it('writes a static entry once', () => {
    const written: string[] = [];
    const bridge = new ScrollbackBridge({ sink: (text) => written.push(text) });

    bridge.append('u1', 'a user message');
    bridge.append('u1', 'a user message');
    expect(written).toEqual(['a user message\n']);
  });

  it('starts clean after reset', () => {
    const written: string[] = [];
    const bridge = new ScrollbackBridge({ sink: (text) => written.push(text) });

    bridge.append('u1', 'first');
    bridge.reset();
    bridge.append('u1', 'first');

    expect(written).toEqual(['first\n', 'first\n']);
  });
});
