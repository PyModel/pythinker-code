<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ColorScheme, Theme } from '../../../composables/usePythinkerWebClient';

defineProps<{
  theme: Theme;
  colorScheme: ColorScheme;
  uiFontSize: number;
  authReady: boolean;
  accountModel?: string | null;
  notify: boolean;
  notifyPermission?: string;
}>();

const emit = defineEmits<{
  setTheme: [theme: Theme];
  setColorScheme: [colorScheme: ColorScheme];
  setUiFontSize: [size: number];
  setNotify: [on: boolean];
  login: [];
  openOnboarding: [];
}>();

const { t } = useI18n();
const desktopBridge = typeof window !== 'undefined' ? window.pythinkerDesktop : undefined;
const desktopAutoUpdate = ref(true);
const desktopUpdateState = ref<DesktopUpdateState>();
let removeDesktopUpdateListener: (() => void) | undefined;

const desktopStatusText = computed(() => {
  const state = desktopUpdateState.value;
  if (state === undefined) return '';
  if (state.status === 'disabled') return t('settings.desktop.disabled');
  if (state.status === 'idle') return state.message ? t('settings.desktop.upToDate') : '';
  if (state.status === 'checking') return t('settings.desktop.checking');
  if (state.status === 'available' || state.status === 'downloading') {
    return state.version
      ? t('settings.desktop.downloading', { version: state.version })
      : t('settings.desktop.downloadingUnknown');
  }
  if (state.status === 'downloaded') return t('settings.desktop.updateReady');
  return state.message
    ? t('settings.desktop.error', { message: state.message })
    : t('settings.desktop.errorGeneric');
});

const desktopCheckDisabled = computed(() => {
  const status = desktopUpdateState.value?.status;
  return status === 'checking' || status === 'downloading';
});

function setDesktopUpdateState(state: DesktopUpdateState): void {
  desktopUpdateState.value = state;
  desktopAutoUpdate.value = state.autoUpdate;
}

function setDesktopUpdateError(error: unknown): void {
  desktopUpdateState.value = {
    status: 'error',
    autoUpdate: desktopAutoUpdate.value,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function setDesktopAutoUpdate(enabled: boolean): Promise<void> {
  if (desktopBridge === undefined) return;
  desktopAutoUpdate.value = enabled;
  try {
    const state = await desktopBridge.setAutoUpdate(enabled);
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

async function checkDesktopForUpdates(): Promise<void> {
  if (desktopBridge === undefined) return;
  try {
    const state = await desktopBridge.checkForUpdates();
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

async function restartDesktopToUpdate(): Promise<void> {
  if (desktopBridge === undefined) return;
  try {
    const state = await desktopBridge.quitAndInstall();
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

onMounted(() => {
  if (desktopBridge === undefined) return;
  removeDesktopUpdateListener = desktopBridge.onUpdateState(setDesktopUpdateState);
  void desktopBridge.getUpdateState().then(setDesktopUpdateState).catch(setDesktopUpdateError);
});

onUnmounted(() => {
  removeDesktopUpdateListener?.();
});
</script>

<template>
  <section id="settings-panel-general" class="panel" role="tabpanel" aria-labelledby="settings-tab-general">
    <section class="sec">
      <h3 class="sec-title">{{ t('settings.appearance') }}</h3>
      <div class="row">
        <span class="rlabel">{{ t('theme.label') }}</span>
        <div class="seg" role="group" :aria-label="t('theme.label')">
          <button type="button" class="opt" :class="{ on: theme === 'modern' }" :aria-pressed="theme === 'modern'" @click="emit('setTheme', 'modern')">{{ t('theme.modern') }}</button>
          <button type="button" class="opt" :class="{ on: theme === 'pythinker' }" :aria-pressed="theme === 'pythinker'" @click="emit('setTheme', 'pythinker')">{{ t('theme.pythinker') }}</button>
        </div>
      </div>
      <div class="row">
        <span class="rlabel">{{ t('theme.colorSchemeLabel') }}</span>
        <div class="seg" role="group" :aria-label="t('theme.colorSchemeLabel')">
          <button type="button" class="opt" :class="{ on: colorScheme === 'light' }" :aria-pressed="colorScheme === 'light'" @click="emit('setColorScheme', 'light')">{{ t('theme.light') }}</button>
          <button type="button" class="opt" :class="{ on: colorScheme === 'dark' }" :aria-pressed="colorScheme === 'dark'" @click="emit('setColorScheme', 'dark')">{{ t('theme.dark') }}</button>
          <button type="button" class="opt" :class="{ on: colorScheme === 'system' }" :aria-pressed="colorScheme === 'system'" @click="emit('setColorScheme', 'system')">{{ t('theme.system') }}</button>
        </div>
      </div>
      <div class="row">
        <span class="rlabel">{{ t('settings.uiFontSize') }}</span>
        <label class="num-field">
          <input
            class="num-input"
            type="number"
            min="12"
            max="20"
            step="1"
            :value="uiFontSize"
            :aria-label="t('settings.uiFontSize')"
            @input="emit('setUiFontSize', Number(($event.target as HTMLInputElement).value))"
          />
          <span class="num-unit">px</span>
        </label>
      </div>
    </section>

    <section class="sec">
      <h3 class="sec-title">{{ t('settings.notifications') }}</h3>
      <div class="row">
        <span class="rlabel">
          {{ t('settings.notifyOnComplete') }}
          <span v-if="notifyPermission === 'denied'" class="hint">{{ t('settings.notifyDenied') }}</span>
        </span>
        <button
          type="button"
          class="switch"
          role="switch"
          :class="{ on: notify }"
          :aria-checked="notify"
          :disabled="notifyPermission === 'denied'"
          @click="emit('setNotify', !notify)"
        >
          <span class="knob" />
        </button>
      </div>
    </section>

    <section v-if="desktopBridge !== undefined" class="sec">
      <h3 class="sec-title">{{ t('settings.desktop.title') }}</h3>
      <div class="row">
        <span class="rlabel">
          {{ t('settings.desktop.automaticUpdates') }}
          <span class="hint">{{ t('settings.desktop.automaticUpdatesHint') }}</span>
        </span>
        <button type="button" class="switch" role="switch" :class="{ on: desktopAutoUpdate }" :aria-checked="desktopAutoUpdate" @click="void setDesktopAutoUpdate(!desktopAutoUpdate)">
          <span class="knob" />
        </button>
      </div>
      <div v-if="desktopStatusText" class="row">
        <span class="rlabel">{{ t('settings.desktop.status') }}</span>
        <span class="rvalue">{{ desktopStatusText }}</span>
      </div>
      <div class="actions">
        <button type="button" class="act" :disabled="desktopCheckDisabled" @click="void checkDesktopForUpdates()">{{ t('settings.desktop.checkForUpdates') }}</button>
        <button v-if="desktopUpdateState?.status === 'downloaded'" type="button" class="act" @click="void restartDesktopToUpdate()">{{ t('settings.desktop.restartToUpdate') }}</button>
      </div>
    </section>

    <section class="sec">
      <h3 class="sec-title">{{ t('settings.account') }}</h3>
      <div class="row">
        <span class="rlabel">{{ authReady ? t('sidebar.signedIn') : t('sidebar.notSignedIn') }}</span>
        <span v-if="authReady && accountModel" class="rvalue" :title="accountModel">{{ accountModel }}</span>
      </div>
      <div class="actions">
        <button type="button" class="act" @click="emit('openOnboarding')">{{ t('onboarding.reopen') }}</button>
        <button type="button" class="act signin" @click="emit('login')">{{ t('providers.title') }}</button>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>

<style scoped>
.num-field {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}
.num-input {
  width: 48px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--ui-font-size-sm);
  text-align: right;
}
.num-unit { color: var(--muted); font-family: var(--mono); font-size: var(--ui-font-size-xs); }
.seg { display: inline-flex; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; }
.opt {
  padding: 5px 12px;
  border: none;
  border-left: 1px solid var(--line);
  background: var(--bg);
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  cursor: pointer;
}
.opt:first-child { border-left: none; }
.opt:hover { color: var(--ink); }
.opt.on { background: var(--soft); color: var(--blue2); font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
</style>
