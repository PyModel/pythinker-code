<script setup lang="ts">
// Shown when someone who has already finished setup can no longer reach a
// model: a revoked key, a deleted provider, a model the provider withdrew.
// Deliberately not the first-run wizard — these people are not new users, and
// re-onboarding them would throw away the context they already have.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';

const emit = defineEmits<{ openProviders: []; dismiss: [] }>();
const { t } = useI18n();
const client = usePythinkerWebClient();

const providers = computed(() => client.providers.value ?? []);
const firstProvider = computed(() => providers.value[0]);

/** Which of the three ways to lose a model this is, so the screen can say what
 *  actually broke instead of a generic "not signed in". */
const reason = computed<'noProvider' | 'credential' | 'noModel'>(() => {
  if (providers.value.length === 0) return 'noProvider';
  return providers.value.some((provider) => provider.status === 'connected')
    ? 'noModel'
    : 'credential';
});

const message = computed(() =>
  reason.value === 'noProvider'
    ? t('recovery.noProvider')
    : t(`recovery.${reason.value}`, { provider: firstProvider.value?.id ?? '' }),
);

async function retry(): Promise<void> {
  await client.refreshRuntimeState();
}
</script>

<template>
  <section class="recovery">
    <div class="recovery__inner">
      <span class="recovery__mark" aria-hidden="true"><Icon name="alert-triangle" size="md" /></span>
      <div class="recovery__copy">
        <h1>{{ t('recovery.title') }}</h1>
        <p>{{ message }}</p>
      </div>

      <div class="recovery__options">
        <button
          v-if="reason !== 'noProvider'"
          type="button"
          class="recovery__option is-primary"
          data-testid="recovery-open-providers"
          @click="emit('openProviders')"
        >
          <span class="recovery__option-name">{{ t('recovery.fixProvider') }}</span>
          <span class="recovery__option-desc">{{ t('recovery.fixProviderDesc') }}</span>
        </button>
        <button
          type="button"
          class="recovery__option"
          :class="{ 'is-primary': reason === 'noProvider' }"
          data-testid="recovery-add-provider"
          @click="emit('openProviders')"
        >
          <span class="recovery__option-name">{{ t('recovery.addProvider') }}</span>
          <span class="recovery__option-desc">{{ t('recovery.addProviderDesc') }}</span>
        </button>
      </div>

      <div class="recovery__actions">
        <Button variant="secondary" data-testid="recovery-retry" @click="retry">
          {{ t('recovery.retry') }}
        </Button>
        <Button variant="ghost" data-testid="recovery-dismiss" @click="emit('dismiss')">
          {{ t('recovery.dismiss') }}
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.recovery {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--bg);
  color: var(--color-text);
  box-sizing: border-box;
}
.recovery__inner {
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
}
.recovery__mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-sm);
  background: var(--panel);
  color: var(--warn);
}
.recovery__copy { display: flex; flex-direction: column; gap: 8px; }
.recovery__copy h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.15;
  font-weight: 500;
  color: var(--color-text);
}
.recovery__copy p {
  margin: 0;
  font-size: var(--ui-font-size-lg);
  line-height: 1.55;
  color: var(--dim);
}
.recovery__options { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.recovery__option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg);
  cursor: pointer;
}
.recovery__option:hover { background: var(--hover); }
.recovery__option.is-primary { border-color: var(--bd); background: var(--bluebg); }
.recovery__option-name { font-size: var(--ui-font-size); font-weight: var(--weight-medium); }
.recovery__option-desc { font-size: var(--ui-font-size-sm); color: var(--muted); }
.recovery__actions { display: flex; gap: 8px; }
</style>
