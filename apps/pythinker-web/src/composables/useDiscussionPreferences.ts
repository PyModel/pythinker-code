import { readonly, ref } from 'vue';

import { safeGetString, safeSetString, STORAGE_KEYS } from '../lib/storage';

const reasoningVisible = ref(safeGetString(STORAGE_KEYS.discussionReasoning) !== 'false');
const showReasoning = readonly(reasoningVisible);

function setShowReasoning(value: boolean): void {
  reasoningVisible.value = value;
  safeSetString(STORAGE_KEYS.discussionReasoning, String(value));
}

const preferences = { showReasoning, setShowReasoning };

export function useDiscussionPreferences(): typeof preferences {
  return preferences;
}
