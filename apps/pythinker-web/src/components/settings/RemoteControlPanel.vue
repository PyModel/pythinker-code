<!-- apps/pythinker-web/src/components/settings/RemoteControlPanel.vue -->
<!-- Settings → Remote Control: turn the relay tunnel on or off and show its link as a QR code. -->
<script setup lang="ts">
import QRCode from 'qrcode';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppRemoteControlStatus } from '../../api/types';
import { copyTextToClipboard } from '../../lib/clipboard';
import Button from '../ui/Button.vue';
import Spinner from '../ui/Spinner.vue';
import Switch from '../ui/Switch.vue';

const { t } = useI18n();

const status = ref<AppRemoteControlStatus | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const qr = ref<string | null>(null);
const copied = ref(false);

const isOn = computed(() => status.value?.state === 'on' && status.value.url !== undefined);
const canToggle = computed(() => status.value !== null && !status.value.startedInTerminal && !busy.value);

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load(): Promise<void> {
  error.value = null;
  try {
    status.value = await getPythinkerWebApi().getRemoteControl();
  } catch (e) {
    error.value = messageOf(e);
  }
}

async function toggle(enabled: boolean): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    status.value = await getPythinkerWebApi().setRemoteControl(enabled);
    if (status.value.error !== undefined) error.value = status.value.error;
  } catch (e) {
    await load();
    error.value = messageOf(e);
  } finally {
    busy.value = false;
  }
}

async function copyLink(): Promise<void> {
  const url = status.value?.url;
  if (url === undefined) return;
  if (!(await copyTextToClipboard(url))) return;
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

watch(
  () => (isOn.value ? status.value?.url : undefined),
  async (url) => {
    qr.value = url === undefined ? null : await QRCode.toDataURL(url, { margin: 2, width: 240 });
  },
);

onMounted(load);
</script>

<template>
  <section class="rc">
    <h3 class="rc-title">{{ t('settings.remoteControl.title') }}</h3>
    <p class="rc-note">{{ t('settings.remoteControl.note') }}</p>

    <div v-if="status === null && error === null" class="rc-loading"><Spinner size="sm" /></div>

    <div v-if="status !== null" class="rc-row">
      <div class="rc-row-text">
        <span class="rc-label">{{ t('settings.remoteControl.enable') }}</span>
        <span v-if="status.startedInTerminal" class="rc-hint">{{ t('settings.remoteControl.startedInTerminal') }}</span>
      </div>
      <Spinner v-if="busy" size="sm" />
      <Switch
        :model-value="status.enabled"
        :disabled="!canToggle"
        :label="t('settings.remoteControl.enable')"
        @update:model-value="toggle"
      />
    </div>

    <p v-if="error !== null" class="rc-error" role="alert">{{ error }}</p>

    <div v-if="isOn && status" class="rc-link">
      <img v-if="qr !== null" class="rc-qr" :src="qr" :alt="t('settings.remoteControl.qrAlt')" width="240" height="240" />
      <p class="rc-url">{{ status.url }}</p>
      <div class="rc-actions">
        <Button size="sm" variant="secondary" @click="copyLink">
          {{ copied ? t('settings.remoteControl.copied') : t('settings.remoteControl.copy') }}
        </Button>
      </div>
      <p class="rc-warn">{{ t('settings.remoteControl.warning') }}</p>
    </div>
  </section>
</template>

<style scoped>
.rc {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.rc-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.rc-note,
.rc-hint,
.rc-url,
.rc-warn {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: var(--leading-normal);
}
.rc-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.rc-row-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-inline-size: 0;
}
.rc-label {
  color: var(--color-text);
}
.rc-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.rc-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}
.rc-qr {
  inline-size: 240px;
  max-inline-size: 100%;
  block-size: auto;
  border-radius: var(--radius-md);
  background: oklch(1 0 none);
}
.rc-url {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.rc-loading {
  display: flex;
  justify-content: center;
}
</style>
