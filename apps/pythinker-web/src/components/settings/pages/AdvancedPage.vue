<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { serverEndpointLabel } from '../../../api/config';
import { downloadTraceLog, isTraceEnabled } from '../../../debug/trace';

const { t } = useI18n();
const daemonEndpoint = serverEndpointLabel();

function exportLog(): void {
  downloadTraceLog();
}
</script>

<template>
  <section id="settings-panel-advanced" class="panel" role="tabpanel" aria-labelledby="settings-tab-advanced">
    <section class="sec">
      <h3 class="sec-title">{{ t('settings.advanced') }}</h3>
      <div class="row">
        <span class="rlabel">{{ t('sidebar.daemon') }}</span>
        <span class="rvalue mono">{{ daemonEndpoint }}</span>
      </div>
      <div class="row">
        <span class="rlabel">
          {{ t('settings.exportLog') }}
          <span v-if="!isTraceEnabled()" class="hint">{{ t('settings.logHint') }}</span>
        </span>
        <button type="button" class="act" @click="exportLog">{{ t('settings.exportLogBtn') }}</button>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
