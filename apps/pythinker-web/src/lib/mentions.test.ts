import { describe, expect, it } from 'vitest';
import {
  isRevivableSkillActivation,
  middleTruncateName,
  parseMentionSegments,
  serializeMention,
  serializeSkillActivation,
  skillActivationDisplayText,
} from './mentions';

describe('mentions', () => {
  it('round-trips escaped file names and paths', () => {
    const attrs = { kind: 'file' as const, name: 'weird [name] 100%.ts', path: '/a b/weird [name] 100%.ts' };
    expect(parseMentionSegments(serializeMention(attrs))).toEqual([{ type: 'mention', attrs }]);
  });

  it('appends and classifies a folder suffix', () => {
    expect(parseMentionSegments(serializeMention({ kind: 'folder', name: 'src', path: '/work/src' }))).toEqual([
      { type: 'mention', attrs: { kind: 'folder', name: 'src', path: '/work/src/' } },
    ]);
  });

  it('round-trips skill mentions', () => {
    const attrs = { kind: 'skill' as const, name: 'code-review', path: '' };
    expect(parseMentionSegments(serializeMention(attrs))).toEqual([{ type: 'mention', attrs }]);
  });

  it('serializes reversible skill activations for edit and display', () => {
    const activation = { name: 'code-review', args: 'focus on errors' };
    expect(serializeSkillActivation(activation, { revivePill: false })).toBe(
      '/skill:code-review focus on errors',
    );
    expect(isRevivableSkillActivation(activation, { revivePill: false })).toBe(true);
    expect(skillActivationDisplayText(activation)).toBe(
      `${serializeMention({ kind: 'skill', name: 'code-review', path: '' })} focus on errors`,
    );
  });

  it('does not revive a nested activation pill as a slash command', () => {
    const args = serializeMention({ kind: 'skill', name: 'code-review', path: '' });
    const activation = { name: 'code-review', args };
    expect(serializeSkillActivation(activation, { revivePill: false })).toBeNull();
    expect(serializeSkillActivation(activation, { revivePill: true })).toBe(args);
    expect(skillActivationDisplayText(activation)).toBe(args);
  });

  it('leaves web links as text', () => {
    expect(parseMentionSegments('[link](https://example.com)')).toEqual([
      { type: 'text', value: '[link](https://example.com)' },
    ]);
  });

  it('leaves image syntax as text', () => {
    expect(parseMentionSegments('![img](/a/b.png)')).toEqual([{ type: 'text', value: '![img](/a/b.png)' }]);
  });

  it('preserves text around mentions in order', () => {
    expect(parseMentionSegments('before [n](/p/n.ts) after')).toEqual([
      { type: 'text', value: 'before ' },
      { type: 'mention', attrs: { kind: 'file', name: 'n', path: '/p/n.ts' } },
      { type: 'text', value: ' after' },
    ]);
  });

  it('truncates only names longer than 32 graphemes', () => {
    const exact = 'a'.repeat(32);
    const long = `${'verylongname'.repeat(5)}.tsx`;
    expect(middleTruncateName(exact)).toBe(exact);
    expect(middleTruncateName(long)).toMatch(/^.{8,}….+\.tsx$/u);
    expect(Array.from(middleTruncateName(long))).toHaveLength(32);
  });
});
