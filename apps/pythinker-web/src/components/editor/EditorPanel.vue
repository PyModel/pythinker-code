<!-- apps/pythinker-web/src/components/editor/EditorPanel.vue -->
<!-- Workspace file editor: PanelHeader chrome (path + dirty dot + save/close),
     conflict banner with reload/overwrite, and the lazy MonacoPane body.
     Claims the 'editor' slot of the shared right-side detail layer. -->
<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Banner from '../ui/Banner.vue';
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import Icon from '../ui/Icon.vue';
import Spinner from '../ui/Spinner.vue';
import Tooltip from '../ui/Tooltip.vue';
import PanelHeader from '../ui/PanelHeader.vue';
import EmptyState from '../ui/EmptyState.vue';
import MonacoPane from './MonacoPane.vue';
import {
  closeFileEditor,
  overwriteFileEditor,
  reloadFileEditor,
  saveFileEditor,
  useWorkspaceEditorState,
} from '../../composables/useWorkspaceEditor';

const { t } = useI18n();
const state = useWorkspaceEditorState();

const emit = defineEmits<{ close: [] }>();

function handleClose(): void {
  closeFileEditor();
  emit('close');
}

function truncatePath(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  return name.length > 0 ? name : path;
}

const savedRecently = computed(() => {
  if (state.savedAt === null || state.dirty) return false;
  return Date.now() - state.savedAt < 2000;
});

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveFileEditor();
  }
}

window.addEventListener('keydown', onKeydown);
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

watch(
  () => state.open,
  (open) => {
    if (!open) emit('close');
  },
);
</script>

<template>
  <div class="editor-panel">
    <PanelHeader
      wrap
      :title="t('editor.title')"
      closable
      :close-label="t('editor.closeEditor')"
      @close="handleClose"
    >
      <template v-if="state.path !== null">
        <Tooltip :text="state.path">
          <span class="ed-path">{{ truncatePath(state.path) }}</span>
        </Tooltip>
        <Tooltip v-if="state.dirty" :text="t('editor.unsavedDot')">
          <span class="ed-dirty" />
        </Tooltip>
        <span v-if="savedRecently" class="ed-saved">{{ t('editor.saved') }}</span>
      </template>
      <template v-if="state.path !== null && state.loadError === null">
        <IconButton
          v-if="!state.conflict"
          size="sm"
          :label="t('editor.save')"
          :disabled="!state.dirty || state.saving"
          @click="saveFileEditor()"
        >
          <Icon name="check" size="sm" />
        </IconButton>
        <span v-if="state.saving" class="ed-saving">
          <Spinner size="sm" />
        </span>
      </template>
    </PanelHeader>

    <div v-if="state.loadError !== null" class="editor-panel__empty">
      <EmptyState>
        <span>{{ state.loadError }}</span>
        <Button variant="secondary" size="sm" @click="handleClose">
          {{ t('filePreview.close') }}
        </Button>
      </EmptyState>
    </div>

    <template v-else>
      <Banner v-if="state.conflict" variant="warning" class="editor-panel__conflict">
        <span>{{ t('editor.conflictText') }}</span>
        <span class="editor-panel__conflict-actions">
          <Button variant="secondary" size="sm" @click="reloadFileEditor()">
            {{ t('editor.conflictReload') }}
          </Button>
          <Button variant="danger" size="sm" :disabled="state.saving" @click="overwriteFileEditor()">
            {{ t('editor.conflictOverwrite') }}
          </Button>
        </span>
      </Banner>
      <p v-if="state.savingError !== null" class="editor-panel__save-error">{{ state.savingError }}</p>
      <MonacoPane v-if="state.path !== null" :path="state.path" :language-id="state.languageId" />
    </template>
  </div>
</template>

<style scoped>
.editor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.ed-path {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-muted);
}
.ed-dirty {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--color-warning);
}
.ed-saved {
  flex: none;
  font: var(--text-xs) var(--font-ui);
  color: var(--color-success);
}
.ed-saving {
  display: inline-flex;
  align-items: center;
}
.editor-panel__conflict {
  margin: var(--space-2) var(--space-3) 0;
}
.editor-panel__conflict-actions {
  display: inline-flex;
  gap: var(--space-2);
  margin-left: var(--space-3);
}
.editor-panel__save-error {
  margin: var(--space-2) var(--space-3) 0;
  font: var(--text-xs) var(--font-ui);
  color: var(--color-danger);
}
.editor-panel__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}
</style>
