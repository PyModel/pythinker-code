import { OPEN_PLATFORMS } from '@pymodel/pythinker-code-oauth';

import { PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE } from '#/utils/region';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const PYTHINKER_CODE_MAINLAND_CN_OPTION: ChoiceOption = {
  value: 'pythinker-code',
  label: 'Pythinker Code (kimi.com/code)',
};
const PYTHINKER_CODE_GLOBAL_OPTION: ChoiceOption = {
  value: PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE,
  label: 'Pythinker Code (kimi.ai/code)',
};

function platformOptions(): readonly ChoiceOption[] {
  return [
    PYTHINKER_CODE_MAINLAND_CN_OPTION,
    PYTHINKER_CODE_GLOBAL_OPTION,
    ...OPEN_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name })),
  ];
}

export interface PlatformSelectorOptions {
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...platformOptions()],
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
