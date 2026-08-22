<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TodoView } from '../../types';
import Icon from '../ui/Icon.vue';
import Spinner from '../ui/Spinner.vue';
defineProps<{ todos: TodoView[] }>();
const { t } = useI18n();
</script>
<template>
  <div class="todo-card">
    <div v-if="todos.length === 0" class="tc-empty"><Icon class="tc-empty-ico" name="list" size="lg" /><span>{{ t('tasks.emptyTodo') }}</span></div>
    <div v-for="(todo, index) in todos" v-else :key="index" class="tc-row" :class="`s-${todo.status}`">
      <span class="tc-glyph" :class="`g-${todo.status}`"><Icon v-if="todo.status === 'done'" name="check" size="md" /><Spinner v-else-if="todo.status === 'in_progress'" class="tc-spin" size="sm" /></span>
      <span class="tc-name">{{ todo.title }}</span>
    </div>
  </div>
</template>
<style scoped>
.todo-card { display:flex; flex-direction:column; gap:var(--space-3); font-size:var(--text-base) }.tc-row{display:flex;align-items:center;gap:var(--space-2);color:var(--color-text)}.tc-name{flex:1;min-width:0;overflow-wrap:anywhere;line-height:var(--leading-caption)}.tc-row.s-in_progress .tc-name{font-weight:var(--weight-medium)}.tc-row.s-pending .tc-name{color:var(--color-text-muted)}.tc-glyph{flex:none;width:var(--p-ic-md);height:var(--p-ic-md);display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-full)}.tc-glyph.g-done{color:var(--color-success)}.tc-glyph.g-pending{border:var(--p-ring-stroke) solid var(--color-line-strong)}.tc-glyph .tc-spin{color:var(--color-text)}.tc-empty{display:flex;flex-direction:column;align-items:center;gap:var(--space-2);padding:var(--space-6) var(--space-4);color:var(--color-text-faint);font-size:var(--text-sm)}.tc-empty-ico{width:var(--p-empty-ico);height:var(--p-empty-ico);color:var(--color-line-strong)}@media(max-width:640px){.todo-card{font-size:var(--text-lg)}.tc-row{padding:var(--space-2) var(--space-3)}}
</style>
