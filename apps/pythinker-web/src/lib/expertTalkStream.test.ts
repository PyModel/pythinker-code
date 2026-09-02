import { describe, expect, it } from 'vitest';

import { extractStreamingAnswer } from './expertTalkStream';

describe('extractStreamingAnswer', () => {
  it('passes plain prose through untouched', () => {
    expect(extractStreamingAnswer('# Draft\n\nProse.')).toBeUndefined();
    expect(extractStreamingAnswer(undefined)).toBeUndefined();
  });

  it('decodes a partial answer while the envelope is still streaming', () => {
    const partial = '{"version":"expert_talk_result/v1","answer":"# Roadmap\\n\\nBuild a **Mac** app.\\n- item one\\n- ite';
    expect(extractStreamingAnswer(partial)).toBe('# Roadmap\n\nBuild a **Mac** app.\n- item one\n- ite');
  });

  it('stops at the end of the answer field once notes start streaming', () => {
    const text = '{"version":"expert_talk_result/v1","answer":"Done \\"quoted\\".","notes":{"consensus":["a"]}}';
    expect(extractStreamingAnswer(text)).toBe('Done "quoted".');
  });

  it('shows nothing before the answer field arrives', () => {
    expect(extractStreamingAnswer('{"version":"expert_talk_res')).toBe('');
  });

  it('tolerates a trailing half escape sequence', () => {
    expect(extractStreamingAnswer('{"answer":"line\\')).toBe('line');
    expect(extractStreamingAnswer('{"answer":"caf\\u00e')).toBe('caf');
  });
});
