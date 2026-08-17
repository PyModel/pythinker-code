<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppConfig, AppSkill } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

const props = defineProps<{
  config?: AppConfig | null;
  skills?: AppSkill[];
}>();

const emit = defineEmits<{
  updateConfig: [patch: Partial<AppConfig>];
}>();

const { t } = useI18n();
const skillQuery = ref('');

const skillGroups = computed(() => {
  const query = skillQuery.value.trim().toLowerCase();
  const matching = (props.skills ?? []).filter(
    (skill) => query === '' || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
  );
  const bySource = new Map<string, AppSkill[]>();
  for (const skill of matching) {
    const group = bySource.get(skill.source) ?? [];
    group.push(skill);
    bySource.set(skill.source, group);
  }
  return [...bySource.entries()]
    .map(([source, groupedSkills]) => ({
      source,
      skills: groupedSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
    .toSorted((a, b) => a.source.localeCompare(b.source));
});

const disabledSkills = computed(() => new Set(props.config?.disabledSkills ?? []));
const skillCount = computed(() => skillGroups.value.reduce((sum, group) => sum + group.skills.length, 0));

function isSkillEnabled(name: string): boolean {
  return !disabledSkills.value.has(name);
}

function toggleSkill(name: string): void {
  const next = new Set(disabledSkills.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  emit('updateConfig', { disabledSkills: [...next].sort() });
}
</script>

<template>
  <section id="settings-panel-skills" class="panel" role="tabpanel" aria-labelledby="settings-tab-skills">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.skills.title') }}</h2>
      <p class="sec-note">{{ t('settings.skills.note') }}</p>
      <input v-model="skillQuery" type="search" class="page-search" :placeholder="t('settings.skills.search')" :aria-label="t('settings.skills.search')">
      <p class="listing-count">{{ t('settings.skills.count', { count: skillCount }) }}</p>
      <p v-if="skillGroups.length === 0" class="sec-empty">{{ t('settings.skills.empty') }}</p>
      <div v-for="group in skillGroups" :key="group.source" class="listing">
        <h4 class="listing-head">{{ group.source }}</h4>
        <ListingRow v-for="skill in group.skills" :key="`${group.source}/${skill.name}`" :name="skill.name" mono :off="!isSkillEnabled(skill.name)">
          <template #glyph>
            <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l2.1 4.9 5.4.5-4.1 3.6 1.2 5.3L12 14.6 7.4 17.3l1.2-5.3L4.5 8.4l5.4-.5L12 3z" stroke-linejoin="round" /></svg>
          </template>
          <span v-if="skill.disableModelInvocation" class="tag">{{ t('settings.skills.slashOnly') }}</span>
          <span class="listing-desc">{{ skill.description }}</span>
          <template #actions>
            <button type="button" class="switch sm" role="switch" :class="{ on: isSkillEnabled(skill.name) }" :aria-checked="isSkillEnabled(skill.name)" :aria-label="t('settings.skills.toggleAria', { name: skill.name })" @click="toggleSkill(skill.name)"><span class="knob" /></button>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
