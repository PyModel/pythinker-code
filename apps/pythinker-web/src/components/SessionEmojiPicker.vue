<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  EMOJI_GROUPS,
  loadRecentEmojis,
  recordRecentEmoji,
  searchEmoji,
} from '../lib/sessionEmoji';
import Input from './ui/Input.vue';
import Popover from './ui/Popover.vue';

const props = defineProps<{
  anchor: HTMLElement | null;
  open: boolean;
  currentEmoji?: string | null;
}>();

const emit = defineEmits<{
  select: [emoji: string];
  remove: [];
  close: [];
}>();

const { t } = useI18n();
const query = ref('');
const recents = ref(loadRecentEmojis());
const results = computed(() => searchEmoji(query.value, Number.POSITIVE_INFINITY));
const randomEmojis = [
  '⏳', '⚠️', '🐛', '✨', '🔥', '🚀', '🎯', '🧪', '📝', '🔍', '🛠️', '💡', '📦', '🎨', '🔒', '📈',
  '🧹', '🚧', '✅', '❓', '🌙', '☕', '🐳', '🗂️', '📊', '🤖', '🧩', '⚙️', '🌱', '📌', '💥', '🕐',
];
const groupLabels = {
  faces: 'sidebar.emojiGroupFaces',
  nature: 'sidebar.emojiGroupNature',
  food: 'sidebar.emojiGroupFood',
  activity: 'sidebar.emojiGroupActivity',
  objects: 'sidebar.emojiGroupObjects',
  symbols: 'sidebar.emojiGroupSymbols',
} as const;

function choose(emoji: string): void {
  recents.value = recordRecentEmoji(emoji);
  emit('select', emoji);
}

function random(): void {
  let emoji: string | undefined;
  do emoji = randomEmojis[Math.floor(Math.random() * randomEmojis.length)];
  while (emoji === props.currentEmoji);
  if (emoji !== undefined) choose(emoji);
}
</script>

<template>
  <Popover
    :anchor="anchor"
    :open="open"
    align="end"
    :label="t('sidebar.sessionEmojiTitle')"
    @close="emit('close')"
  >
    <div class="emoji-picker">
      <Input v-model="query" size="sm" :placeholder="t('sidebar.searchEmoji')" />
      <div class="emoji-actions">
        <button type="button" @click="random">{{ t('sidebar.randomEmoji') }}</button>
        <button v-if="currentEmoji" type="button" @click="emit('remove')">
          {{ t('sidebar.removeEmoji') }}
        </button>
      </div>

      <template v-if="query">
        <div v-if="results.length" class="emoji-grid">
          <button
            v-for="emoji in results"
            :key="emoji"
            type="button"
            class="emoji"
            @click="choose(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
        <div v-else class="emoji-empty">{{ t('sidebar.noEmojiResults') }}</div>
      </template>

      <template v-else>
        <section v-if="recents.length" class="emoji-group">
          <h3>{{ t('sidebar.recentEmojis') }}</h3>
          <div class="emoji-grid">
            <button
              v-for="emoji in recents"
              :key="emoji"
              type="button"
              class="emoji"
              @click="choose(emoji)"
            >
              {{ emoji }}
            </button>
          </div>
        </section>
        <section v-for="group in EMOJI_GROUPS" :key="group.id" class="emoji-group">
          <h3>{{ t(groupLabels[group.id]) }}</h3>
          <div class="emoji-grid">
            <button
              v-for="entry in group.emojis"
              :key="entry.emoji"
              type="button"
              class="emoji"
              @click="choose(entry.emoji)"
            >
              {{ entry.emoji }}
            </button>
          </div>
        </section>
      </template>
    </div>
  </Popover>
</template>

<style scoped>
.emoji-picker {
  width: min(320px, calc(100vw - 40px));
  max-height: min(440px, calc(100vh - 48px));
  padding: var(--space-3);
  overflow-y: auto;
  background: var(--color-surface-raised);
}
.emoji-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-2);
}
.emoji-actions button {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.emoji-actions button:hover { color: var(--color-text); }
.emoji-group h3 {
  margin: var(--space-3) 0 var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: var(--space-1);
}
.emoji {
  display: grid;
  place-items: center;
  min-width: 32px;
  min-height: 32px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: var(--text-lg);
  cursor: pointer;
}
.emoji:hover { background: var(--color-hover); }
.emoji:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.emoji-empty {
  padding: var(--space-5) 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
