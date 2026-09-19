<!-- apps/pythinker-web/src/components/GlobalLoading.vue -->
<!-- Full-screen splash shown on first load until the client has talked to the
     daemon, so a page refresh doesn't flash a half-rendered, not-yet-connected
     app. Hidden once usePythinkerWebClient.initialized flips true. -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Spinner from './ui/Spinner.vue';

export type BootStage = 'auth' | 'server' | 'config' | 'sessions' | 'session';

export type ConnectIssue =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'api'; message: string }
  | { kind: 'unknown'; message: string }
  | string
  | null;

const props = defineProps<{
  stage?: BootStage | null;
  retries?: number;
  issue?: ConnectIssue;
}>();

const { t } = useI18n();

const stageLabel = computed(() => {
  switch (props.stage) {
    case 'auth':
      return t('app.connectingStageAuth');
    case 'server':
      return t('app.connectingStageServer');
    case 'config':
      return t('app.connectingStageConfig');
    case 'sessions':
      return t('app.connectingStageSessions');
    case 'session':
      return t('app.connectingStageSession');
    default:
      return '';
  }
});

const stageWithRetries = computed(() => {
  const base = stageLabel.value;
  if (!base) return '';
  const retries = props.retries ?? 0;
  if (retries <= 0) return base;
  return base + t('app.connectingRetrySuffix', { n: retries });
});

const issueTitle = computed(() => {
  const issue = props.issue;
  if (issue === null || issue === undefined || issue === '') return '';
  if (typeof issue === 'string') return t('app.connectRetrying');
  switch (issue.kind) {
    case 'network':
      return t('app.connectingIssueNetworkTitle');
    case 'timeout':
      return t('app.connectingIssueTimeoutTitle');
    case 'api':
      return t('app.connectingIssueApiTitle');
    case 'unknown':
      return t('app.connectingIssueUnknownTitle');
    default:
      return t('app.connectRetrying');
  }
});

const issueDetail = computed(() => {
  const issue = props.issue;
  if (issue === null || issue === undefined || issue === '') return '';
  if (typeof issue === 'string') return issue;
  switch (issue.kind) {
    case 'network':
      return t('app.connectingIssueNetworkMessage');
    case 'timeout':
      return t('app.connectingIssueTimeoutMessage');
    case 'api':
    case 'unknown':
      return issue.message;
    default:
      return '';
  }
});
</script>

<template>
  <div class="gload" role="status" :aria-label="t('app.connecting')">
    <div class="gload-box">
      <img class="gload-logo" src="/logo.png" alt="Pythinker" width="120" height="120" />
      <Spinner size="md" :label="t('app.connecting')" />
      <div class="gload-text">
        <div>{{ t('app.connecting') }}</div>
        <div v-if="stageWithRetries" class="gload-stage">{{ stageWithRetries }}</div>
        <div v-if="issueTitle" class="gload-issue-title">{{ issueTitle }}</div>
        <div v-if="issueDetail" class="gload-issue-detail">{{ issueDetail }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gload {
  position: fixed;
  top: 0;
  left: 0;
  /* Viewport units for size + position so the splash always fills the screen,
     even if a transformed/collapsed <html> would otherwise shrink a fixed box. */
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-width: 100vw;
  min-height: 100dvh;
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.gload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  /* nudge slightly above center — feels more intentional than dead-center */
  transform: translateY(-6%);
}
.gload-logo {
  width: 120px;
  height: 120px;
  object-fit: contain;
  animation: gload-pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.gload-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  max-width: min(480px, 80vw);
  font-family: var(--sans);
  font-size: var(--text-xl);
  color: var(--muted);
  letter-spacing: 0.04em;
  text-align: center;
}
.gload-stage {
  font-size: var(--text-base);
  letter-spacing: 0;
  color: var(--muted);
  opacity: 0.9;
}
.gload-issue-title {
  margin-top: var(--space-2);
  font-size: var(--text-base);
  letter-spacing: 0;
  color: var(--muted);
}
.gload-issue-detail {
  font-family: var(--mono);
  font-size: var(--text-base);
  letter-spacing: 0;
  color: var(--muted);
  opacity: 0.8;
  word-break: break-word;
}
@keyframes gload-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .gload-logo { animation: none; }
}
</style>
