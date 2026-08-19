import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  uiFontScaleForSize,
  uiFontScaleOptions,
  uiFontSizeForScale,
} from '../src/composables/client/useAppearance';
import { i18n } from '../src/i18n';
import { messages } from '../src/i18n/locales';

describe('settings UI', () => {
  it('uses the reference font-size presets', () => {
    expect(uiFontScaleOptions).toEqual([
      { value: 'small', label: 'S' },
      { value: 'medium', label: 'M' },
      { value: 'large', label: 'L' },
      { value: 'xlarge', label: 'XL' },
    ]);
    expect(['small', 'medium', 'large', 'xlarge'].map(uiFontSizeForScale)).toEqual([12, 14, 16, 18]);
    expect([12, 14, 16, 18].map(uiFontScaleForSize)).toEqual(['small', 'medium', 'large', 'xlarge']);
  });

  it('ships English as the only interface language', () => {
    expect(i18n.global.locale.value).toBe('en');
    expect(Object.keys(messages)).toEqual(['en']);
  });

  it('does not expose DynamicWorkflow as a manual mode', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const composer = readFileSync(join(webRoot, 'src/components/chat/Composer.vue'), 'utf8');
    const mobile = readFileSync(join(webRoot, 'src/components/mobile/MobileSettingsSheet.vue'), 'utf8');
    expect(composer).not.toContain('toggleDynamicWorkflow');
    expect(mobile).not.toContain('toggleDynamicWorkflow');
  });

  it('shows the Pythinker logo beside the empty-conversation heading', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const conversation = readFileSync(join(webRoot, 'src/components/chat/ConversationPane.vue'), 'utf8');

    expect(conversation).toContain('<PythinkerLogo v-else size="md"');
  });
});
