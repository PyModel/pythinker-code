<!-- Windows caption buttons. The desktop shell drops `titleBarOverlay` on
     win32, so nothing native is drawn there and the renderer owns the controls.
     They keep the macOS traffic-light shape but sit on the trailing edge, where
     Windows users look for them. -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const isWindows = computed(() => window.pythinkerDesktop?.platform === 'win32');

function minimize(): void {
  void window.pythinkerDesktop?.minimizeWindow();
}

function toggleMaximize(): void {
  void window.pythinkerDesktop?.toggleMaximizeWindow();
}

function close(): void {
  void window.pythinkerDesktop?.closeWindow();
}
</script>

<template>
  <div v-if="isWindows" class="window-controls">
    <button type="button" class="wc wc-min" :aria-label="t('app.minimizeWindow')" @click="minimize">
      <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M2.5 5h5" />
      </svg>
    </button>
    <button type="button" class="wc wc-max" :aria-label="t('app.maximizeWindow')" @click="toggleMaximize">
      <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
        <rect x="2.4" y="2.4" width="5.2" height="5.2" rx="1" />
      </svg>
    </button>
    <button type="button" class="wc wc-close" :aria-label="t('app.closeWindow')" @click="close">
      <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M3 3l4 4M7 3l-4 4" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  position: fixed;
  top: 12px;
  right: 14px;
  z-index: 60;
  display: flex;
  gap: 8px;
  /* The strip underneath drags the window; the buttons must not. */
  -webkit-app-region: no-drag;
}
.wc {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* The glyph only appears on hover, exactly as macOS does it. */
  color: transparent;
}
.wc-close { background: #ff5f57; }
.wc-min { background: #febc2e; }
.wc-max { background: #28c840; }
.window-controls:hover .wc { color: rgba(0, 0, 0, 0.55); }
.wc:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
  color: rgba(0, 0, 0, 0.55);
}
</style>
