import type { InjectionKey } from 'vue';

import type { UseExpertTalkState } from './client/useExpertTalkState';

export const expertTalkContextKey: InjectionKey<UseExpertTalkState> = Symbol('expertTalk');
