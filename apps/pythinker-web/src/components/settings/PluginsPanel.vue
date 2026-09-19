<!-- apps/pythinker-web/src/components/settings/PluginsPanel.vue -->
<!-- Settings → Plugins: marketplace catalog + installed enable/disable/remove. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppPlugin, AppPluginMarketplaceEntry } from '../../api/types';
import Button from '../ui/Button.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Input from '../ui/Input.vue';
import Spinner from '../ui/Spinner.vue';
import Switch from '../ui/Switch.vue';
import Tooltip from '../ui/Tooltip.vue';

const { t } = useI18n();

const loading = ref(false);
const loaded = ref(false);
const error = ref<string | null>(null);
const catalogError = ref(false);
const installed = ref<AppPlugin[]>([]);
const entries = ref<AppPluginMarketplaceEntry[]>([]);
const busy = ref<Record<string, boolean>>({});
const rowErrors = ref<Record<string, string>>({});
const customOpen = ref(false);
const customSource = ref('');
const customInput = ref<{ el?: HTMLInputElement } | null>(null);

const CUSTOM_BUSY_KEY = '__custom__';

const installedById = computed(() => new Map(installed.value.map((plugin) => [plugin.id, plugin])));

const catalogEntries = computed(() =>
  entries.value.filter((entry) => entry.capabilityId === undefined),
);
const officialEntries = computed(() => catalogEntries.value.filter((entry) => entry.tier === 'official'));
const thirdPartyEntries = computed(() => catalogEntries.value.filter((entry) => entry.tier !== 'official'));
const installedOnly = computed(() => {
  const catalogIds = new Set(entries.value.map((entry) => entry.id));
  return installed.value.filter((plugin) => !catalogIds.has(plugin.id));
});
const isEmpty = computed(
  () =>
    officialEntries.value.length === 0 &&
    thirdPartyEntries.value.length === 0 &&
    installedOnly.value.length === 0,
);

function busyKey(id: string, action: string): string {
  return `${id}:${action}`;
}

function isBusy(id: string, action: string): boolean {
  return busy.value[busyKey(id, action)] === true;
}

function rowBusy(id: string, pluginId?: string): boolean {
  const key = pluginId ?? id;
  return isBusy(id, 'install') || isBusy(key, 'remove') || isBusy(key, 'toggle');
}

async function withBusy(id: string, action: string, run: () => Promise<void>): Promise<void> {
  const key = busyKey(id, action);
  busy.value = { ...busy.value, [key]: true };
  const nextErrors = { ...rowErrors.value };
  delete nextErrors[id];
  rowErrors.value = nextErrors;
  try {
    await run();
  } catch (err) {
    rowErrors.value = {
      ...rowErrors.value,
      [id]: err instanceof Error ? err.message : String(err),
    };
  } finally {
    const next = { ...busy.value };
    delete next[key];
    busy.value = next;
  }
}

async function refresh(force = false): Promise<void> {
  if (loading.value && !force) return;
  loading.value = true;
  error.value = null;
  catalogError.value = false;
  try {
    const api = getPythinkerWebApi();
    const [plugins, marketplace] = await Promise.all([
      api.listPlugins(),
      api.listPluginMarketplace().catch(() => {
        catalogError.value = true;
        return [] as AppPluginMarketplaceEntry[];
      }),
    ]);
    installed.value = plugins;
    entries.value = marketplace;
    loaded.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function countsLabel(plugin: AppPlugin): string {
  return t('settings.plugins.counts', {
    skills: plugin.skillCount,
    servers: plugin.mcpServerCount,
  });
}

function openHomepage(url: string): void {
  window.open(url, '_blank', 'noopener');
}

function entryCounts(entry: AppPluginMarketplaceEntry): string {
  const plugin = installedById.value.get(entry.id);
  if (plugin) return countsLabel(plugin);
  return entry.version ? entry.version : '';
}

async function installEntry(entry: AppPluginMarketplaceEntry): Promise<void> {
  await withBusy(entry.id, 'install', async () => {
    await getPythinkerWebApi().installPlugin(entry.source);
    await refresh(true);
  });
}

async function installCustom(): Promise<void> {
  const source = customSource.value.trim();
  if (!source || isBusy(CUSTOM_BUSY_KEY, 'install')) return;
  await withBusy(CUSTOM_BUSY_KEY, 'install', async () => {
    await getPythinkerWebApi().installPlugin(source);
    customSource.value = '';
    customOpen.value = false;
    await refresh(true);
  });
}

async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await withBusy(pluginId, 'toggle', async () => {
    await getPythinkerWebApi().setPluginEnabled(pluginId, enabled);
    installed.value = installed.value.map((plugin) =>
      plugin.id === pluginId ? { ...plugin, enabled } : plugin,
    );
  });
}

async function remove(pluginId: string): Promise<void> {
  await withBusy(pluginId, 'remove', async () => {
    await getPythinkerWebApi().removePlugin(pluginId);
    await refresh(true);
  });
}

function toggleCustom(): void {
  customOpen.value = !customOpen.value;
  if (customOpen.value) {
    void Promise.resolve().then(() => customInput.value?.el?.focus());
  }
}

onMounted(() => {
  void refresh(true);
});
</script>

<template>
  <section class="pp">
    <h3 class="pp-title">{{ t('settings.tabs.plugins') }}</h3>
    <p class="pp-note">{{ t('settings.plugins.note') }}</p>

    <div class="pp-custom" :class="{ open: customOpen }">
      <button type="button" class="pp-custom-row" @click="toggleCustom">
        <Icon name="plus" size="md" />
        <span>{{ t('settings.plugins.customInstall') }}</span>
        <span class="pp-chev" :class="{ open: customOpen }">
          <Icon name="chevron-right" size="sm" />
        </span>
      </button>
      <div v-if="customOpen" class="pp-custom-body">
        <form class="pp-custom-form" @submit.prevent="installCustom">
          <Input
            ref="customInput"
            v-model="customSource"
            class="pp-custom-input"
            :placeholder="t('settings.plugins.customInstallPlaceholder')"
            :aria-label="t('settings.plugins.customInstall')"
          />
          <Button
            size="sm"
            variant="primary"
            type="submit"
            :loading="isBusy(CUSTOM_BUSY_KEY, 'install')"
            :disabled="customSource.trim() === ''"
          >
            {{ t('settings.plugins.install') }}
          </Button>
        </form>
        <p class="pp-hint">{{ t('settings.plugins.customInstallHint') }}</p>
        <p v-if="rowErrors[CUSTOM_BUSY_KEY]" class="pp-error">{{ rowErrors[CUSTOM_BUSY_KEY] }}</p>
      </div>
    </div>

    <p v-if="catalogError" class="pp-warn">{{ t('settings.plugins.catalogUnavailable') }}</p>

    <div v-if="loading && !loaded" class="pp-loading">
      <Spinner size="sm" />
      <span>{{ t('settings.plugins.loading') }}</span>
    </div>
    <div v-else-if="error" class="pp-error-block">
      <span>{{ error }}</span>
      <Button size="sm" variant="secondary" @click="refresh(true)">
        {{ t('settings.plugins.retry') }}
      </Button>
    </div>
    <EmptyState v-else-if="isEmpty" :title="t('settings.plugins.empty')" />
    <template v-else>
      <section v-if="officialEntries.length > 0" class="pp-group">
        <h4 class="pp-group-title">{{ t('settings.plugins.official') }}</h4>
        <div class="pp-list">
          <article v-for="entry in officialEntries" :key="entry.id" class="pp-row">
            <div class="pp-main">
              <div class="pp-name-row">
                <span class="pp-name">{{ entry.displayName }}</span>
                <span v-if="entry.version" class="pp-ver">{{ entry.version }}</span>
              </div>
              <p v-if="entry.description" class="pp-desc">{{ entry.description }}</p>
              <p v-if="entryCounts(entry)" class="pp-meta">{{ entryCounts(entry) }}</p>
              <p v-if="rowErrors[entry.id]" class="pp-error">{{ rowErrors[entry.id] }}</p>
              <p v-if="installedById.get(entry.id)?.hasErrors" class="pp-error">
                {{ t('settings.plugins.hasErrors') }}
              </p>
            </div>
            <div class="pp-actions">
              <template v-if="installedById.has(entry.id)">
                <Switch
                  :model-value="installedById.get(entry.id)!.enabled"
                  :disabled="rowBusy(entry.id, entry.id)"
                  :aria-label="t('settings.plugins.enabled')"
                  @update:model-value="setEnabled(entry.id, $event)"
                />
                <Tooltip :text="t('settings.plugins.remove')">
                  <IconButton
                    size="sm"
                    :label="t('settings.plugins.remove')"
                    :disabled="rowBusy(entry.id, entry.id)"
                    @click="remove(entry.id)"
                  >
                    <Icon name="close" size="sm" />
                  </IconButton>
                </Tooltip>
              </template>
              <Button
                v-else
                size="sm"
                variant="secondary"
                :loading="isBusy(entry.id, 'install')"
                @click="installEntry(entry)"
              >
                {{ entry.updateAvailable ? t('settings.plugins.update') : t('settings.plugins.install') }}
              </Button>
              <Tooltip v-if="entry.homepage" :text="t('settings.plugins.homepage')">
                <IconButton
                  size="sm"
                  :label="t('settings.plugins.homepage')"
                  @click="openHomepage(entry.homepage!)"
                >
                  <Icon name="external-link" size="sm" />
                </IconButton>
              </Tooltip>
            </div>
          </article>
        </div>
      </section>

      <section v-if="thirdPartyEntries.length > 0" class="pp-group">
        <h4 class="pp-group-title">{{ t('settings.plugins.thirdParty') }}</h4>
        <div class="pp-list">
          <article v-for="entry in thirdPartyEntries" :key="entry.id" class="pp-row">
            <div class="pp-main">
              <div class="pp-name-row">
                <span class="pp-name">{{ entry.displayName }}</span>
                <span v-if="entry.version" class="pp-ver">{{ entry.version }}</span>
              </div>
              <p v-if="entry.description" class="pp-desc">{{ entry.description }}</p>
              <p v-if="entryCounts(entry)" class="pp-meta">{{ entryCounts(entry) }}</p>
              <p v-if="rowErrors[entry.id]" class="pp-error">{{ rowErrors[entry.id] }}</p>
            </div>
            <div class="pp-actions">
              <template v-if="installedById.has(entry.id)">
                <Switch
                  :model-value="installedById.get(entry.id)!.enabled"
                  :disabled="rowBusy(entry.id, entry.id)"
                  :aria-label="t('settings.plugins.enabled')"
                  @update:model-value="setEnabled(entry.id, $event)"
                />
                <Tooltip :text="t('settings.plugins.remove')">
                  <IconButton
                    size="sm"
                    :label="t('settings.plugins.remove')"
                    :disabled="rowBusy(entry.id, entry.id)"
                    @click="remove(entry.id)"
                  >
                    <Icon name="close" size="sm" />
                  </IconButton>
                </Tooltip>
              </template>
              <Button
                v-else
                size="sm"
                variant="secondary"
                :loading="isBusy(entry.id, 'install')"
                @click="installEntry(entry)"
              >
                {{ t('settings.plugins.install') }}
              </Button>
            </div>
          </article>
        </div>
      </section>

      <section v-if="installedOnly.length > 0" class="pp-group">
        <h4 class="pp-group-title">{{ t('settings.plugins.installed') }}</h4>
        <div class="pp-list">
          <article v-for="plugin in installedOnly" :key="plugin.id" class="pp-row">
            <div class="pp-main">
              <div class="pp-name-row">
                <span class="pp-name">{{ plugin.displayName }}</span>
                <span v-if="plugin.version" class="pp-ver">{{ plugin.version }}</span>
              </div>
              <p v-if="countsLabel(plugin)" class="pp-meta">{{ countsLabel(plugin) }}</p>
              <p v-if="plugin.hasErrors" class="pp-error">{{ t('settings.plugins.hasErrors') }}</p>
              <p v-if="rowErrors[plugin.id]" class="pp-error">{{ rowErrors[plugin.id] }}</p>
            </div>
            <div class="pp-actions">
              <Switch
                :model-value="plugin.enabled"
                :disabled="rowBusy(plugin.id)"
                :aria-label="t('settings.plugins.toggleAria', { name: plugin.displayName })"
                @update:model-value="setEnabled(plugin.id, $event)"
              />
              <Tooltip :text="t('settings.plugins.remove')">
                <IconButton
                  size="sm"
                  :label="t('settings.plugins.remove')"
                  :disabled="rowBusy(plugin.id)"
                  @click="remove(plugin.id)"
                >
                  <Icon name="close" size="sm" />
                </IconButton>
              </Tooltip>
            </div>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.pp {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pp-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.pp-note,
.pp-hint,
.pp-desc,
.pp-meta {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: var(--leading-normal);
}
.pp-custom {
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}
.pp-custom-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.pp-custom-row:hover {
  background: var(--color-hover);
}
.pp-chev {
  margin-left: auto;
  color: var(--color-text-faint);
  transition: transform var(--duration-fast) var(--ease-out);
}
.pp-chev.open {
  transform: rotate(90deg);
}
.pp-custom-body {
  padding: 0 var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pp-custom-form {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.pp-custom-input {
  flex: 1;
  min-width: 0;
}
.pp-warn,
.pp-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-warning);
}
.pp-error {
  color: var(--color-danger);
}
.pp-loading,
.pp-error-block {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.pp-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pp-group-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pp-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pp-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.pp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.pp-name-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.pp-name {
  font-weight: var(--weight-medium);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-ver {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  font-family: var(--font-mono);
}
.pp-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}
</style>
