<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ActivitySpinner from './ActivitySpinner.vue';
import MenuRow from './ui/MenuRow.vue';
import Popover from './ui/Popover.vue';
import SwitchToggle from './ui/SwitchToggle.vue';
import { usePythinkerWebClient } from '../composables/usePythinkerWebClient';

const props = defineProps<{
  sessionId?: string;
}>();

type MenuView = 'root' | 'tools' | 'skills' | 'plugins';
type SessionCapabilities = { tools?: string[]; mcpServers?: string[] };

const { t } = useI18n();
const client = usePythinkerWebClient();
const triggerRef = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const view = ref<MenuView>('root');
const selectedTools = ref<string[]>([]);
const selectedMcpServers = ref<string[]>([]);

const tools = computed(() => {
  const sessionId = props.sessionId;
  return sessionId ? client.toolsBySession.value[sessionId] ?? [] : [];
});
const toolsLoading = computed(() => {
  const sessionId = props.sessionId;
  return sessionId ? client.toolsLoadingBySession.value[sessionId] === true : false;
});
const skills = computed(() =>
  props.sessionId === client.activeSessionId.value ? client.skills.value : [],
);
const skillsLoading = computed(() => {
  const sessionId = props.sessionId;
  return sessionId ? client.skillsLoadingBySession.value[sessionId] === true : false;
});
const connectors = computed(() => client.connectors.value);
const connectorsLoading = computed(() => client.connectorsLoading.value);
const plugins = computed(() => client.plugins.value);
const pluginsLoading = computed(() => client.pluginsLoading.value);
const capabilities = computed<SessionCapabilities>(() =>
  props.sessionId === client.activeSessionId.value
    ? client.activeSessionCapabilities.value
    : {},
);

const showTools = computed(() => toolsLoading.value || tools.value.length > 0);
const showSkills = computed(() => skillsLoading.value || skills.value.length > 0);
const showMcp = computed(() => connectorsLoading.value || connectors.value.length > 0);
const showPlugins = computed(() => pluginsLoading.value || plugins.value.length > 0);

const drilldownTitle = computed(() => {
  switch (view.value) {
    case 'tools': return t('capabilityMenu.tools.title');
    case 'skills': return t('capabilityMenu.skills.title');
    case 'plugins': return t('capabilityMenu.plugins.title');
    case 'root': return '';
  }
});

const drilldownCount = computed(() => {
  switch (view.value) {
    case 'tools': return selectedTools.value.length;
    case 'skills': return skills.value.length;
    case 'plugins': return plugins.value.length;
    case 'root': return 0;
  }
});

function syncSelection(): void {
  selectedTools.value = capabilities.value.tools !== undefined
    ? [...capabilities.value.tools]
    : tools.value.map((tool) => tool.name);
  selectedMcpServers.value = capabilities.value.mcpServers !== undefined
    ? [...capabilities.value.mcpServers]
    : connectors.value.map((server) => server.id);
}

watch(
  [() => props.sessionId, tools, connectors, capabilities],
  syncSelection,
  { immediate: true },
);

watch(
  [tools, toolsLoading, skills, skillsLoading, plugins, pluginsLoading],
  () => {
    if (view.value === 'tools' && !toolsLoading.value && tools.value.length === 0) view.value = 'root';
    if (view.value === 'skills' && !skillsLoading.value && skills.value.length === 0) view.value = 'root';
    if (view.value === 'plugins' && !pluginsLoading.value && plugins.value.length === 0) view.value = 'root';
  },
);

function toggleOpen(): void {
  open.value = !open.value;
  if (!open.value) {
    view.value = 'root';
    return;
  }
  if (props.sessionId) void client.loadCapabilityData(props.sessionId);
}

function close(): void {
  open.value = false;
  view.value = 'root';
}

// Each capability field owns one write chain. A snapshot is read when the write
// leaves the chain, so the daemon sees the toggles in the order the user made
// them: a slow `[A]` can no longer land after `[A, B]` and drop B. A failed
// write only rolls the selection back while it is still the newest one —
// otherwise a stale failure would discard a newer toggle.
type CapabilityField = 'tools' | 'mcpServers';

const writeChain: Record<CapabilityField, Promise<void>> = {
  tools: Promise.resolve(),
  mcpServers: Promise.resolve(),
};
const writeCount: Record<CapabilityField, number> = { tools: 0, mcpServers: 0 };

function queueWrite(field: CapabilityField, selection: Ref<string[]>, previous: string[]): Promise<void> {
  const seq = ++writeCount[field];
  // The write belongs to the session that was rendered when the user toggled.
  // `updateCapabilities` always targets the active session, so a queued write
  // that outlives a session switch must be dropped, not sent to the new one —
  // and its rollback must not touch the new session's selection either.
  const sessionId = props.sessionId;
  const write = writeChain[field].then(async () => {
    if (props.sessionId !== sessionId) return;
    try {
      await client.updateCapabilities({ [field]: [...selection.value] });
    } catch {
      if (seq === writeCount[field] && props.sessionId === sessionId) selection.value = previous;
    }
  });
  writeChain[field] = write;
  return write;
}

function setToolEnabled(name: string, enabled: boolean): Promise<void> {
  const previous = [...selectedTools.value];
  const next = new Set(previous);
  if (enabled) next.add(name);
  else next.delete(name);
  selectedTools.value = [...next];
  return queueWrite('tools', selectedTools, previous);
}

function setMcpServerEnabled(id: string, enabled: boolean): Promise<void> {
  const previous = [...selectedMcpServers.value];
  const next = new Set(previous);
  if (enabled) next.add(id);
  else next.delete(id);
  selectedMcpServers.value = [...next];
  return queueWrite('mcpServers', selectedMcpServers, previous);
}

function setPluginEnabled(id: string, enabled: boolean): void {
  void client.setPluginEnabled(id, enabled);
}
</script>

<template>
  <div class="capability-control">
    <button
      ref="triggerRef"
      type="button"
      class="capability-trigger"
      :class="{ open }"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="t('capabilityMenu.triggerLabel')"
      @click.stop="toggleOpen"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 3.5h8M4 8h8M4 12.5h8" />
        <circle cx="6" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="7" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
      <span class="capability-trigger-label">{{ t('capabilityMenu.trigger') }}</span>
    </button>

    <Popover :anchor="triggerRef" :open="open" :label="t('capabilityMenu.triggerLabel')" @close="close">
      <div class="capability-panel">
        <div class="capability-viewport">
          <div class="capability-track" :class="{ 'is-drilled': view !== 'root' }">
            <div class="capability-view">
              <MenuRow v-if="showTools" :count="selectedTools.length" @click="view = 'tools'">
                <template #label>{{ t('capabilityMenu.tools.title') }}</template>
                <template #trailing>
                  <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                </template>
              </MenuRow>

              <MenuRow v-if="showSkills" :count="skills.length" @click="view = 'skills'">
                <template #label>{{ t('capabilityMenu.skills.title') }}</template>
                <template #trailing>
                  <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                </template>
              </MenuRow>

              <div v-if="showMcp" class="capability-group">
                <div class="capability-group-title">{{ t('capabilityMenu.mcp.title') }}</div>
                <p class="capability-caption">{{ t('capabilityMenu.mcp.caption') }}</p>
                <div v-if="connectorsLoading" class="capability-loading">
                  <ActivitySpinner :label="t('capabilityMenu.loading')" />
                </div>
                <template v-else>
                  <MenuRow
                    v-for="server in connectors"
                    :key="server.id"
                    class="mcp-row"
                    :selected="selectedMcpServers.includes(server.id)"
                    :title="server.name"
                    @click="void setMcpServerEnabled(server.id, !selectedMcpServers.includes(server.id))"
                  >
                    <template #label>{{ server.name }}</template>
                    <template #trailing>
                      <SwitchToggle
                        :model-value="selectedMcpServers.includes(server.id)"
                        :aria-label="t('capabilityMenu.mcp.toggle', { name: server.name })"
                        @click.stop
                        @update:model-value="void setMcpServerEnabled(server.id, $event)"
                      />
                    </template>
                  </MenuRow>
                </template>
              </div>

              <MenuRow v-if="showPlugins" :count="plugins.length" @click="view = 'plugins'">
                <template #label>{{ t('capabilityMenu.plugins.title') }}</template>
                <template #trailing>
                  <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                </template>
              </MenuRow>
            </div>

            <div class="capability-view capability-view-secondary">
              <MenuRow v-if="view !== 'root'" class="capability-back" :count="drilldownCount" @click="view = 'root'">
                <template #leading>
                  <svg class="back-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
                </template>
                <template #label>{{ drilldownTitle || t('capabilityMenu.back') }}</template>
              </MenuRow>

              <template v-if="view === 'tools'">
                <p class="capability-caption">{{ t('capabilityMenu.tools.caption') }}</p>
                <div v-if="toolsLoading" class="capability-loading">
                  <ActivitySpinner :label="t('capabilityMenu.loading')" />
                </div>
                <template v-else>
                  <MenuRow
                    v-for="tool in tools"
                    :key="tool.name"
                    class="capability-row"
                    :selected="selectedTools.includes(tool.name)"
                    :title="tool.description"
                    @click="void setToolEnabled(tool.name, !selectedTools.includes(tool.name))"
                  >
                    <template #label>{{ tool.name }}</template>
                    <template #trailing>
                      <SwitchToggle
                        :model-value="selectedTools.includes(tool.name)"
                        :aria-label="t('capabilityMenu.tools.toggle', { name: tool.name })"
                        @click.stop
                        @update:model-value="void setToolEnabled(tool.name, $event)"
                      />
                    </template>
                  </MenuRow>
                </template>
              </template>

              <template v-else-if="view === 'skills'">
                <p class="capability-caption">{{ t('capabilityMenu.skills.caption') }}</p>
                <div v-if="skillsLoading" class="capability-loading">
                  <ActivitySpinner :label="t('capabilityMenu.loading')" />
                </div>
                <template v-else>
                  <MenuRow
                    v-for="skill in skills"
                    :key="skill.name"
                    class="skill-row"
                    disabled
                    :title="skill.description"
                    :aria-label="t('capabilityMenu.skills.toggle', { name: skill.name })"
                  >
                    <template #label>{{ skill.name }}</template>
                  </MenuRow>
                </template>
              </template>

              <template v-else-if="view === 'plugins'">
                <p class="capability-caption">{{ t('capabilityMenu.plugins.caption') }}</p>
                <div v-if="pluginsLoading" class="capability-loading">
                  <ActivitySpinner :label="t('capabilityMenu.loading')" />
                </div>
                <template v-else>
                  <MenuRow
                    v-for="plugin in plugins"
                    :key="plugin.id"
                    class="plugin-row"
                    :selected="plugin.enabled"
                    :title="plugin.displayName"
                    @click="setPluginEnabled(plugin.id, !plugin.enabled)"
                  >
                    <template #label>{{ plugin.displayName }}</template>
                    <template #trailing>
                      <SwitchToggle
                        :model-value="plugin.enabled"
                        :aria-label="t('capabilityMenu.plugins.toggle', { name: plugin.displayName })"
                        @click.stop
                        @update:model-value="setPluginEnabled(plugin.id, $event)"
                      />
                    </template>
                  </MenuRow>
                </template>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.capability-control {
  display: flex;
  align-items: center;
  flex: none;
  min-width: 0;
}

.capability-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  min-width: 30px;
  height: 30px;
  padding: 2px 7px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--ui-font-size);
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}

.capability-trigger:hover,
.capability-trigger.open {
  background: var(--soft);
  color: var(--ink);
}

.capability-trigger svg {
  width: 16px;
  height: 16px;
  flex: none;
}

.capability-panel {
  width: 280px;
  max-height: 288px;
  overflow: hidden;
}

.capability-viewport {
  max-height: 288px;
  overflow: hidden;
}

.capability-track {
  display: flex;
  align-items: flex-start;
  width: 200%;
  transform: translateX(0);
  transition: transform 150ms ease;
}

.capability-track.is-drilled {
  transform: translateX(-50%);
}

.capability-view {
  flex: 0 0 50%;
  min-width: 0;
  max-height: 288px;
  overflow-y: auto;
}

.capability-group-title {
  padding: 6px 8px 2px;
  color: var(--ink);
  font-size: var(--ui-font-size-xs);
  font-weight: 600;
}

.capability-caption {
  margin: 0;
  padding: 2px 8px 6px;
  color: var(--muted);
  font-size: var(--ui-font-size-xs);
  line-height: 1.35;
}

.capability-loading {
  display: flex;
  align-items: center;
  min-height: 27px;
  padding: 0 8px 6px;
  color: var(--muted);
}

.capability-loading :deep(.activity-spin) {
  font-size: var(--ui-font-size-sm);
}

.chevron,
.back-chevron {
  display: block;
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.capability-back {
  margin-bottom: 2px;
}

@media (max-width: 640px) {
  .capability-trigger-label {
    display: none;
  }

  .capability-trigger {
    padding: 2px 6px;
  }
}
</style>
