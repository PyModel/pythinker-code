<!-- apps/pythinker-web/src/components/GlobalLoading.vue -->
<!-- Full-screen splash shown on first load until the client has talked to the
     daemon, so a page refresh doesn't flash a half-rendered, not-yet-connected
     app. Hidden once usePythinkerWebClient.initialized flips true. -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div class="gload" role="status" :aria-label="t('app.connecting')">
    <div class="gload-box">
      <img
        class="gload-logo"
        src="/logo.png"
        alt="Pythinker"
        width="120"
        height="120"
      />
      <div class="gload-text">{{ t('app.connecting') }}</div>
    </div>
  </div>
</template>

<style scoped>
.gload {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-width: 100vw;
  min-height: 100dvh;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.gload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  transform: translateY(-6%);
}
.gload-logo {
  display: block;
  width: 120px;
  height: 120px;
  object-fit: contain;
  animation: gload-pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) both,
    gload-pulse 2.2s ease-in-out 0.55s infinite;
}
.gload-text {
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 2.5px);
  color: var(--muted);
  letter-spacing: 0.04em;
}
@keyframes gload-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes gload-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.04); opacity: 0.92; }
}
@media (prefers-reduced-motion: reduce) {
  .gload-logo {
    animation: gload-pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}
</style>
