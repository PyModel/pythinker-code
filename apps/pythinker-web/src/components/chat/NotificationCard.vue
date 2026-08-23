<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TaskNotification } from '../../types';
import {
  taskNotificationState,
  taskNotificationTone,
  type TaskNotificationState,
} from '../../lib/taskNotification';
import { copyTextToClipboard } from '../../lib/clipboard';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import MessageTime from './MessageTime.vue';

const props = defineProps<{ items: TaskNotification[] }>();
const { t } = useI18n();

const icons = {
  completed: 'check',
  failed: 'alert-triangle',
  timed_out: 'clock',
  killed: 'stop',
  lost: 'alert-triangle',
  info: 'info',
} as const satisfies Record<TaskNotificationState, string>;

function itemKey(notification: TaskNotification, index: number): string {
  return notification.id !== '' ? `${notification.id}#${index}` : `notification-${index}`;
}

function icon(notification: TaskNotification): (typeof icons)[TaskNotificationState] | 'sparkles' {
  const state = taskNotificationState(notification);
  return state === 'info' && notification.sourceKind === 'subagent' ? 'sparkles' : icons[state];
}

function kindLabel(notification: TaskNotification): string {
  return notification.sourceKind === 'subagent'
    ? t('conversation.notification.kindSubagent')
    : t('conversation.notification.kindTask');
}

function title(notification: TaskNotification): string {
  return t(`conversation.notification.title.${taskNotificationState(notification)}`, {
    kind: kindLabel(notification),
  });
}

function sourceId(notification: TaskNotification): string {
  if (notification.sourceKind === 'subagent' && notification.agentId) {
    return notification.agentId;
  }
  return notification.sourceId;
}

function heading(notification: TaskNotification): string {
  const source = sourceId(notification);
  return source === '' ? title(notification) : `${title(notification)} · ${source}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function previewCaption(notification: TaskNotification): string {
  const preview = notification.outputPreview;
  if (!preview) return '';
  const parts: string[] = [];
  if (preview.truncated === true) {
    parts.push(t('conversation.notification.outputTruncated'));
  }
  if (preview.bytes !== undefined) {
    parts.push(
      preview.totalBytes !== undefined && preview.totalBytes !== preview.bytes
        ? `${formatBytes(preview.bytes)} / ${formatBytes(preview.totalBytes)}`
        : formatBytes(preview.bytes),
    );
  }
  return parts.join(' · ');
}

function hasPreview(notification: TaskNotification): boolean {
  return notification.outputPreview !== undefined &&
    (notification.outputPreview.text !== '' || previewCaption(notification) !== '');
}

const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyPath(path: string, key: string): Promise<void> {
  if (!await copyTextToClipboard(path)) return;
  copiedKey.value = key;
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    copiedKey.value = null;
  }, 1200);
}

onUnmounted(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="ntf-list">
    <div
      v-for="(notification, index) in props.items"
      :key="itemKey(notification, index)"
      class="ntn"
      :class="taskNotificationTone(notification)"
      role="status"
    >
      <div class="ntn-head">
        <Icon :name="icon(notification)" size="sm" class="ntn-ico" aria-hidden="true" />
        <span class="ntn-label">{{ heading(notification) }}</span>
      </div>
      <div class="ntn-bubble">
        <div v-if="notification.title" class="ntn-line">{{ notification.title }}</div>
        <div v-if="notification.body" class="ntn-line">{{ notification.body }}</div>
        <div v-if="notification.outputFile" class="ntn-line ntn-out">
          <Icon class="ntn-out-ic" name="file-text" size="sm" aria-hidden="true" />
          <span class="ntn-out-path" :title="notification.outputFile.path">
            {{ notification.outputFile.path }}
          </span>
          <span v-if="notification.outputFile.bytes !== undefined" class="ntn-out-size">
            {{ formatBytes(notification.outputFile.bytes) }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            @click="copyPath(notification.outputFile.path, itemKey(notification, index))"
          >
            {{
              copiedKey === itemKey(notification, index)
                ? t('conversation.notification.copied')
                : t('conversation.notification.copyPath')
            }}
          </Button>
        </div>
        <div v-if="hasPreview(notification)" class="ntn-line">
          <div v-if="previewCaption(notification)" class="ntn-preview-cap">
            {{ previewCaption(notification) }}
          </div>
          <pre v-if="notification.outputPreview?.text" class="ntn-preview-text">{{ notification.outputPreview.text }}</pre>
        </div>
        <details class="ntn-raw">
          <summary>
            <Icon class="ntn-raw-car" name="chevron-right" size="sm" aria-hidden="true" />
            <span>{{ t('conversation.notification.rawPayload') }}</span>
          </summary>
          <div class="ntn-raw-in">
            <div class="ntn-raw-fields">
              <span class="k">{{ t('conversation.notification.fields.type') }}</span>
              <span class="v">{{ notification.type }}</span>
              <span class="k">{{ t('conversation.notification.fields.source') }}</span>
              <span class="v">{{ notification.sourceKind }} · {{ notification.sourceId }}</span>
              <span class="k">{{ t('conversation.notification.fields.severity') }}</span>
              <span class="v">{{ notification.severity || '—' }}</span>
            </div>
            <pre class="ntn-raw-pre">{{ notification.raw }}</pre>
          </div>
        </details>
      </div>
      <div class="ntn-meta">
        <MessageTime v-if="notification.createdAt" :time="notification.createdAt" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ntf-list {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-3);
  margin: var(--space-2) 0;
}
.ntn {
  margin-left: auto;
  max-width: 78%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.ntn-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
  padding: 0 var(--space-1);
  color: var(--color-text-faint);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}
.ntn-ico { flex: none; }
.ntn.ok .ntn-ico { color: var(--color-success); }
.ntn.err .ntn-ico { color: var(--color-danger); }
.ntn.warn .ntn-ico { color: var(--color-warning); }
.ntn-bubble {
  box-sizing: border-box;
  max-width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--color-user-bubble-bg);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  font-size: var(--content-font-size);
  line-height: var(--leading-normal);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ntn-line + .ntn-line { margin-top: var(--space-1); }
.ntn-out {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--color-surface-raised);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  box-shadow: var(--shadow-xs);
  white-space: normal;
}
.ntn-out-ic { color: var(--color-text-faint); flex: none; }
.ntn-out-path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.ntn-out-size {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.ntn-preview-cap {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  margin-bottom: var(--space-05);
}
.ntn-preview-text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--color-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  overflow: hidden;
}
.ntn-meta {
  margin-top: var(--space-1);
  padding: 0 var(--space-1);
  color: var(--color-text-faint);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}
.ntn-raw { max-width: 100%; }
.ntn-raw summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  user-select: none;
}
.ntn-raw summary::-webkit-details-marker { display: none; }
.ntn-raw summary:hover { color: var(--color-text); }
.ntn-raw-car { transition: transform var(--duration-base) var(--ease-out); }
.ntn-raw[open] .ntn-raw-car { transform: rotate(90deg); }
.ntn-raw-in {
  margin-top: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ntn-raw-fields {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
}
.ntn-raw-fields .k { color: var(--color-text-faint); font-size: var(--text-xs); }
.ntn-raw-fields .v {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ntn-raw-pre {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-raised);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-xs);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--color-text-muted);
  white-space: pre;
  overflow: auto;
  max-width: 100%;
  max-height: 13lh;
}

@media (max-width: 640px) {
  .ntn { max-width: 92%; }
}
</style>
