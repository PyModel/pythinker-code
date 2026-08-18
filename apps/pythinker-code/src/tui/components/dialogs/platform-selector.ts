import {
  OPENAI_CODEX_OAUTH_PLATFORM_ID,
  OPEN_PLATFORMS,
} from '@pymodel/pythinker-code-oauth';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const PLATFORM_OPTIONS: readonly ChoiceOption[] = [
  { value: OPENAI_CODEX_OAUTH_PLATFORM_ID, label: 'OpenAI Codex (OAuth)' },
  ...OPEN_PLATFORMS.map((platform) => ({
    value: platform.id,
    label: platform.name,
  })),
];

export interface PlatformSelectorOptions {
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...PLATFORM_OPTIONS],
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
