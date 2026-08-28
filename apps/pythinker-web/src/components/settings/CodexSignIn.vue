<script setup lang="ts">
// Presentation for a Codex sign-in attempt. Holds no logic of its own: it
// renders whatever phase useCodexLogin reports and forwards the three actions.
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCodexLogin } from '../../composables/useCodexLogin';
import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Icon from '../ui/Icon.vue';
import Input from '../ui/Input.vue';
import Spinner from '../ui/Spinner.vue';

const emit = defineEmits<{ connected: [] }>();
const { t } = useI18n();
const client = usePythinkerWebClient();
const redirectUrl = ref('');

const login = useCodexLogin(async () => {
  await client.refreshRuntimeState();
  // The daemon's own answer to "can I run a turn": it already accounts for a
  // provider existing and a usable model having been adopted.
  const usable = client.authReady.value;
  if (usable) emit('connected');
  return usable;
});

async function submit(): Promise<void> {
  const value = redirectUrl.value.trim();
  if (value === '') return;
  await login.submitRedirect(value);
  redirectUrl.value = '';
}
</script>

<template>
  <div class="codex-signin">
    <template v-if="login.phase.value === 'idle' || login.phase.value === 'cancelled'">
      <!-- A cancelled flow otherwise leaves only the start button, which reads
           as if nothing happened. Name the outcome before offering the retry. -->
      <p v-if="login.phase.value === 'cancelled'" class="codex-signin__denied" role="status">
        {{ t('login.deniedTitle') }}
      </p>
      <Button variant="primary" data-testid="codex-signin-start" @click="login.start()">
        <Icon name="log-in" size="sm" />
        <span>{{ t('codexLogin.signIn') }}</span>
      </Button>
    </template>

    <template v-else-if="login.phase.value === 'connected'">
      <p class="codex-signin__ok" role="status">
        <Icon name="circle-check" size="sm" />
        <span>{{ t('codexLogin.connected') }}</span>
      </p>
    </template>

    <template v-else>
      <p class="codex-signin__status" role="status">
        <Spinner v-if="login.busy.value || login.phase.value !== 'failed'" size="sm" />
        <span>{{ t(`codexLogin.phase.${login.phase.value}`) }}</span>
      </p>

      <p v-if="login.authorizeUrl.value" class="codex-signin__hint">
        {{ t('codexLogin.openLinkHint') }}
        <a :href="login.authorizeUrl.value" target="_blank" rel="noreferrer noopener">
          {{ t('codexLogin.openLink') }}
        </a>
      </p>

      <form
        v-if="login.phase.value === 'waiting_for_code' || login.phase.value === 'exchanging'"
        class="codex-signin__paste"
        @submit.prevent="submit"
      >
        <p class="codex-signin__hint">{{ t('codexLogin.pasteHint') }}</p>
        <Field :label="t('codexLogin.pasteLabel')">
          <Input
            v-model="redirectUrl"
            :placeholder="t('codexLogin.pastePlaceholder')"
            autocomplete="off"
            spellcheck="false"
          />
        </Field>
        <Button type="submit" variant="primary" :loading="login.busy.value">
          {{ t('codexLogin.submit') }}
        </Button>
      </form>

      <p v-if="login.error.value" class="codex-signin__error" role="alert">
        {{ t('codexLogin.failed', { message: login.error.value }) }}
      </p>

      <div class="codex-signin__actions">
        <Button v-if="login.phase.value === 'failed'" variant="primary" @click="login.start()">
          {{ t('codexLogin.retry') }}
        </Button>
        <Button v-else variant="secondary" @click="login.cancel()">
          {{ t('codexLogin.cancel') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.codex-signin__denied {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--text-sm)/var(--leading-normal) var(--font-ui);
}
.codex-signin { display: flex; flex-direction: column; gap: var(--space-3); }
.codex-signin__status,
.codex-signin__ok { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.codex-signin__ok { color: var(--ok); }
.codex-signin__hint { color: var(--color-text-muted); font-size: var(--text-sm); }
.codex-signin__paste { display: flex; flex-direction: column; gap: var(--space-2); }
.codex-signin__error { color: var(--color-danger); font-size: var(--text-sm); }
.codex-signin__actions { display: flex; gap: var(--space-2); }
</style>
