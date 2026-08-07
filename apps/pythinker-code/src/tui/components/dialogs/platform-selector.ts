import { buildPlatformOptions } from '@pythoughts/pythinker-code-sdk';
import type { Catalog } from '@pythoughts/pythinker-code-sdk';

import { ChoicePickerComponent } from './choice-picker';

export interface PlatformSelectorOptions {
  readonly catalog?: Catalog;
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...buildPlatformOptions(opts.catalog ?? {})],
      searchable: true,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
