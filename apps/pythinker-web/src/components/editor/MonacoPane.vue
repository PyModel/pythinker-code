<!-- apps/pythinker-web/src/components/editor/MonacoPane.vue -->
<!-- Lazy Monaco host for the workspace editor layer. Owns the single editor
     instance + one model per open file; syncs buffer changes into the
     useWorkspaceEditor state via markEditorDirty and hands the live text to
     save() through registerEditorContentGetter. All monaco imports are
     dynamic so the chunk loads only when an editor actually opens. -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import Spinner from '../ui/Spinner.vue';
import {
  consumePendingContent,
  markEditorDirty,
  registerEditorContentGetter,
} from '../../composables/useWorkspaceEditor';
import { currentEditorThemeName, useEditorTheme } from '../../composables/useEditorTheme';

const rootRef = ref<HTMLDivElement | null>(null);
const booting = ref(true);

type MonacoModule = typeof import('monaco-editor');

let monaco: MonacoModule | null = null;
let editor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;
let model: import('monaco-editor').editor.ITextModel | null = null;
let modelListener: import('monaco-editor').IDisposable | null = null;

// stream-monaco installs a global worker bridge for chat code blocks; only
// provide our own when it has not run yet.
function ensureMonacoWorkers(): void {
  if (window.MonacoEnvironment !== undefined) return;
  void import('monaco-editor/esm/vs/editor/editor.worker?worker&type=module').then(
    (worker) => {
      window.MonacoEnvironment = { getWorker: () => new worker.default() };
    },
  );
}

function languageFor(serverId?: string): string | undefined {
  const known = new Set([
    'typescript',
    'javascript',
    'json',
    'css',
    'html',
    'markdown',
    'python',
    'rust',
    'go',
    'yaml',
  ]);
  if (serverId !== undefined && known.has(serverId)) return serverId;
  if (serverId === 'typescriptreact' || serverId === 'javascriptreact') {
    return serverId.replace('react', '');
  }
  if (serverId === 'shellscript') return 'shell';
  // undefined lets monaco detect the language from the model URI extension.
  return undefined;
}

async function loadBuffer(): Promise<void> {
  if (monaco === null || editor === null) return;
  const pending = consumePendingContent();
  const path = props.path;
  if (path === null) return;
  const uri = monaco.Uri.parse(`pythinker://session/${encodeURIComponent(path)}`);
  const existing = monaco.editor.getModel(uri);
  modelListener?.dispose();
  model?.dispose();
  model =
    existing ??
    monaco.editor.createModel(
      pending?.content ?? '',
      languageFor(props.languageId),
      uri,
    );
  modelListener = model.onDidChangeContent(() => markEditorDirty());
  editor.setModel(model);
  registerEditorContentGetter(() => model?.getValue() ?? '');
  if (pending?.line !== undefined && pending.line > 0) {
    editor.revealLineInCenter(pending.line);
    editor.setPosition({ lineNumber: pending.line, column: 1 });
  }
}

onMounted(async () => {
  ensureMonacoWorkers();
  await useEditorTheme();
  if (rootRef.value === null) return;
  monaco = await import('monaco-editor');
  if (rootRef.value === null) return;
  editor = monaco.editor.create(rootRef.value, {
    model: null,
    theme: currentEditorThemeName(),
    automaticLayout: true,
    fontSize: 12.5,
    fontFamily:
      '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    padding: { top: 8 },
  });
  booting.value = false;
  await loadBuffer();
});

onUnmounted(() => {
  registerEditorContentGetter(null);
  modelListener?.dispose();
  model?.dispose();
  editor?.dispose();
  model = null;
  modelListener = null;
  editor = null;
  monaco = null;
});

const props = defineProps<{
  path: string | null;
  languageId?: string;
}>();

watch(
  () => [props.path, props.languageId] as const,
  async () => {
    if (editor === null) return;
    await loadBuffer();
  },
);
</script>

<template>
  <div class="monaco-pane">
    <div v-if="booting" class="monaco-pane__boot">
      <Spinner size="sm" />
    </div>
    <div ref="rootRef" class="monaco-pane__host" />
  </div>
</template>

<style scoped>
.monaco-pane {
  position: relative;
  flex: 1;
  min-height: 0;
}
.monaco-pane__host {
  position: absolute;
  inset: 0;
}
.monaco-pane__boot {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
