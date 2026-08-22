import { describe, expect, it } from 'vitest';
import { composeTitle, isEmojiGrapheme, searchEmoji, splitTitleEmoji } from './sessionEmoji';

describe('sessionEmoji', () => {
  it('round-trips plain and emoji-prefixed titles', () => {
    expect(splitTitleEmoji('Fix sidebar')).toEqual({ emoji: null, rest: 'Fix sidebar' });
    expect(splitTitleEmoji('🚀 Ship release')).toEqual({ emoji: '🚀', rest: 'Ship release' });
    expect(composeTitle('🚀', 'Ship release')).toBe('🚀 Ship release');
    expect(composeTitle(null, '🚀 Ship release')).toBe('Ship release');
  });

  it('recognizes VS16 sequences and regional-indicator flags', () => {
    expect(splitTitleEmoji('❤️ Important')).toEqual({ emoji: '❤️', rest: 'Important' });
    expect(splitTitleEmoji('🇺🇸 Release')).toEqual({ emoji: '🇺🇸', rest: 'Release' });
    expect(isEmojiGrapheme('❤️')).toBe(true);
    expect(isEmojiGrapheme('🇺🇸')).toBe(true);
  });

  it('leaves a non-emoji first grapheme untouched', () => {
    expect(splitTitleEmoji('A plan')).toEqual({ emoji: null, rest: 'A plan' });
    expect(isEmojiGrapheme('A')).toBe(false);
  });

  it('searches by English keyword and literal emoji', () => {
    expect(searchEmoji('rocket')).toContain('🚀');
    expect(searchEmoji('❤️')).toContain('❤️');
  });
});
