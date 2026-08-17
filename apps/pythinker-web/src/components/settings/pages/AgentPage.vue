<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppConfig, AppConfigProvider, AppModel } from '../../../api/types';

const props = defineProps<{
  config?: AppConfig | null;
  models?: AppModel[];
  configSaving?: boolean;
}>();

const emit = defineEmits<{
  updateConfig: [patch: Partial<AppConfig>];
}>();

const { t } = useI18n();
const permissionModes = ['manual', 'yolo', 'auto'] as const;

type ModelOption = { id: string; label: string; provider: string };

const modelOptions = computed<ModelOption[]>(() => {
  const byId = new Map<string, ModelOption>();
  for (const model of props.models ?? []) {
    byId.set(model.id, {
      id: model.id,
      label: model.displayName ?? model.model ?? model.id,
      provider: model.provider,
    });
  }
  for (const [id, raw] of Object.entries(props.config?.models ?? {})) {
    if (byId.has(id)) continue;
    const provider = extractConfigModelProvider(raw);
    byId.set(id, {
      id,
      label: formatConfigModelLabel(id, raw, provider),
      provider: provider ?? id,
    });
  }
  return Array.from(byId.values());
});

// A default the catalog no longer offers still has to appear, or the browser
// falls back to the first option and shows a model that was never saved.
const unlistedDefaultModel = computed<string | undefined>(() => {
  const configured = props.config?.defaultModel;
  if (configured === undefined || configured === '') return undefined;
  return modelOptions.value.some((model) => model.id === configured) ? undefined : configured;
});

const modelGroups = computed<Array<{ provider: string; options: ModelOption[] }>>(() => {
  const map = new Map<string, ModelOption[]>();
  for (const option of modelOptions.value) {
    const list = map.get(option.provider) ?? [];
    list.push(option);
    map.set(option.provider, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.label.localeCompare(b.label));
  return Array.from(map.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([provider, options]) => ({ provider, options }));
});

const providerEntries = computed<Array<{ id: string; provider: AppConfigProvider }>>(() =>
  Object.entries(props.config?.providers ?? {})
    .map(([id, provider]) => ({ id, provider }))
    .sort((a, b) => a.id.localeCompare(b.id)),
);

const defaultPermissionMode = computed(() => {
  const mode = props.config?.defaultPermissionMode;
  return mode === 'auto' || mode === 'yolo' || mode === 'manual' ? mode : 'manual';
});

function extractConfigModelProvider(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  return typeof source['provider'] === 'string' ? source['provider'] : undefined;
}

function formatConfigModelLabel(id: string, raw: unknown, provider?: string): string {
  if (!raw || typeof raw !== 'object') return id;
  const source = raw as Record<string, unknown>;
  const model = typeof source['model'] === 'string' ? source['model'] : undefined;
  const resolvedProvider = provider ?? extractConfigModelProvider(raw);
  if (model && resolvedProvider) return `${id} (${resolvedProvider}/${model})`;
  if (model) return `${id} (${model})`;
  return id;
}

function configBool(value: boolean | undefined): boolean {
  return value === true;
}

function setDefaultModel(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!value || value === props.config?.defaultModel) return;
  emit('updateConfig', { defaultModel: value });
}

function setDefaultPermissionMode(mode: 'manual' | 'auto' | 'yolo'): void {
  if (mode === defaultPermissionMode.value) return;
  emit('updateConfig', { defaultPermissionMode: mode });
}

function toggleConfigBoolean(key: 'defaultThinking' | 'defaultPlanMode' | 'mergeAllAvailableSkills' | 'telemetry'): void {
  emit('updateConfig', { [key]: !configBool(props.config?.[key]) } as Partial<AppConfig>);
}
</script>

<template>
  <section id="settings-panel-agent" class="panel" role="tabpanel" aria-labelledby="settings-tab-agent">
    <section class="sec">
      <div class="sec-head">
        <h3 class="sec-title">{{ t('settings.agentDefaults') }}</h3>
        <span v-if="configSaving" class="saving">{{ t('settings.saving') }}</span>
      </div>

      <template v-if="config">
        <div class="row">
          <span class="rlabel">
            {{ t('settings.defaultModel') }}
            <span class="hint">{{ t('settings.defaultModelHint') }}</span>
          </span>
          <select
            v-if="modelGroups.length > 0"
            class="select-field"
            :value="config.defaultModel ?? ''"
            :disabled="configSaving"
            :aria-label="t('settings.defaultModel')"
            @change="setDefaultModel"
          >
            <option v-if="!config.defaultModel" value="" disabled>{{ t('settings.noDefaultModel') }}</option>
            <option v-if="unlistedDefaultModel" :value="unlistedDefaultModel">{{ unlistedDefaultModel }}</option>
            <optgroup v-for="group in modelGroups" :key="group.provider" :label="group.provider">
              <option v-for="model in group.options" :key="model.id" :value="model.id">{{ model.label }}</option>
            </optgroup>
          </select>
          <span v-else class="rvalue mono">{{ config.defaultModel ?? t('settings.noDefaultModel') }}</span>
        </div>

        <div class="row">
          <span class="rlabel">
            {{ t('settings.defaultPermission') }}
            <span class="hint">{{ t('settings.defaultPermissionHint') }}</span>
          </span>
          <div class="seg" role="group" :aria-label="t('settings.defaultPermission')">
            <button
              v-for="mode in permissionModes"
              :key="mode"
              type="button"
              class="opt"
              :class="{ on: defaultPermissionMode === mode }"
              :aria-pressed="defaultPermissionMode === mode"
              :disabled="configSaving"
              @click="setDefaultPermissionMode(mode)"
            >
              {{ t(`settings.permission.${mode}`) }}
            </button>
          </div>
        </div>

        <div class="row">
          <span class="rlabel">{{ t('settings.defaultThinking') }}<span class="hint">{{ t('settings.defaultThinkingHint') }}</span></span>
          <button type="button" class="switch" role="switch" :class="{ on: configBool(config.defaultThinking) }" :aria-checked="configBool(config.defaultThinking)" :disabled="configSaving" @click="toggleConfigBoolean('defaultThinking')"><span class="knob" /></button>
        </div>
        <div class="row">
          <span class="rlabel">{{ t('settings.defaultPlanMode') }}<span class="hint">{{ t('settings.defaultPlanModeHint') }}</span></span>
          <button type="button" class="switch" role="switch" :class="{ on: configBool(config.defaultPlanMode) }" :aria-checked="configBool(config.defaultPlanMode)" :disabled="configSaving" @click="toggleConfigBoolean('defaultPlanMode')"><span class="knob" /></button>
        </div>
        <div class="row">
          <span class="rlabel">{{ t('settings.mergeSkills') }}<span class="hint">{{ t('settings.mergeSkillsHint') }}</span></span>
          <button type="button" class="switch" role="switch" :class="{ on: configBool(config.mergeAllAvailableSkills) }" :aria-checked="configBool(config.mergeAllAvailableSkills)" :disabled="configSaving" @click="toggleConfigBoolean('mergeAllAvailableSkills')"><span class="knob" /></button>
        </div>
        <div v-if="config.telemetry !== undefined" class="row">
          <span class="rlabel">{{ t('settings.telemetry') }}</span>
          <button type="button" class="switch" role="switch" :class="{ on: configBool(config.telemetry) }" :aria-checked="configBool(config.telemetry)" :disabled="configSaving" @click="toggleConfigBoolean('telemetry')"><span class="knob" /></button>
        </div>

        <div v-if="providerEntries.length > 0" class="provider-list">
          <div v-for="{ id, provider } in providerEntries" :key="id" class="provider-row">
            <div class="provider-main">
              <span class="provider-id">{{ id }}</span>
              <span class="provider-type">{{ provider.type }}</span>
            </div>
            <div class="provider-meta">
              <span :class="['provider-badge', provider.hasApiKey ? 'ok' : 'warn']">{{ provider.hasApiKey ? t('settings.credentialReady') : t('settings.credentialMissing') }}</span>
              <span v-if="provider.defaultModel" class="provider-model">{{ provider.defaultModel }}</span>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty-config">{{ t('settings.configUnavailable') }}</div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>

<style scoped>
.sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.sec-head .sec-title { margin-bottom: 0; }
.saving { flex: none; color: var(--muted); font-family: var(--mono); font-size: var(--ui-font-size-xs); }
.seg { display: inline-flex; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-sm); }
.opt { padding: 5px 12px; border: none; border-left: 1px solid var(--line); background: var(--bg); color: var(--muted); font-family: var(--mono); font-size: var(--ui-font-size-xs); cursor: pointer; }
.opt:first-child { border-left: none; }
.opt:hover { color: var(--ink); }
.opt.on { background: var(--soft); color: var(--blue2); font-weight: 600; }
.opt:disabled { opacity: 0.55; cursor: not-allowed; }
.select-field { min-width: 220px; max-width: min(320px, 50vw); height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: calc(var(--ui-font-size) - 1.5px); }
.select-field:disabled { opacity: 0.6; cursor: not-allowed; }
.empty-config { padding: 4px 0; color: var(--muted); font-family: var(--sans); font-size: calc(var(--ui-font-size) - 1px); }
.provider-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.provider-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--panel2); }
.provider-main, .provider-meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
.provider-main { flex: 1; }
.provider-meta { flex: none; max-width: 45%; }
.provider-id, .provider-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-id { color: var(--ink); font-family: var(--mono); font-size: var(--ui-font-size-xs); }
.provider-type, .provider-model { color: var(--muted); font-family: var(--mono); font-size: max(10px, calc(var(--ui-font-size) - 4px)); }
.provider-badge { flex: none; padding: 2px 7px; border-radius: 999px; font-family: var(--mono); font-size: max(10px, calc(var(--ui-font-size) - 4px)); }
.provider-badge.ok { background: color-mix(in srgb, var(--ok) 12%, var(--bg)); color: var(--ok); }
.provider-badge.warn { background: color-mix(in srgb, var(--warn) 12%, var(--bg)); color: var(--warn); }

@media (max-width: 640px) {
  .select-field { width: 100%; max-width: none; }
  .provider-row { align-items: flex-start; flex-direction: column; }
  .provider-meta { max-width: 100%; flex-wrap: wrap; }
}
</style>
