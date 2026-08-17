<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ betaToc?: boolean }>();

const emit = defineEmits<{
  setBetaToc: [on: boolean];
}>();

const { t } = useI18n();
</script>

<template>
  <section id="settings-panel-experimental" class="panel" role="tabpanel" aria-labelledby="settings-tab-experimental">
    <section class="sec">
      <h3 class="sec-title">{{ t('settings.beta') }}</h3>
      <div class="row">
        <span class="rlabel">
          {{ t('settings.betaToc') }}
          <span class="hint">{{ t('settings.betaTocHint') }}</span>
        </span>
        <button type="button" class="switch" role="switch" :class="{ on: betaToc }" :aria-checked="betaToc" @click="emit('setBetaToc', !betaToc)"><span class="knob" /></button>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
