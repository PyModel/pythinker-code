<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useAppearance, type Accent, type ColorScheme } from '../../composables/client/useAppearance';
import PythinkerLogo from '../PythinkerLogo.vue';
import Button from '../ui/Button.vue';

const emit = defineEmits<{ complete: []; skip: [] }>();
const { t } = useI18n();
const { colorScheme, accent, setColorScheme, setAccent } = useAppearance();

const themes: { value: ColorScheme; label: string }[] = [
  { value: 'system', label: t('theme.system') },
  { value: 'light', label: t('theme.light') },
  { value: 'dark', label: t('theme.dark') },
];
const accents: { value: Accent; label: string }[] = [
  { value: 'blue', label: t('theme.accentBlue') },
  { value: 'mono', label: t('theme.accentBlack') },
];
</script>

<template>
  <div class="wizard" role="dialog" aria-modal="true" :aria-label="t('onboarding.title')">
    <div class="wiz-body">
      <section class="wiz-step">
        <PythinkerLogo size="lg" :animated="false" label="Pythinker Code" />
        <h1 class="wiz-title">{{ t('onboarding.title') }}</h1>
        <p class="wiz-sub">{{ t('onboarding.subtitle') }}</p>

        <div class="wiz-step-fill">
          <div class="pref-group">
            <div class="pref-label">{{ t('theme.colorSchemeLabel') }}</div>
            <div class="theme-cards">
              <button
                v-for="theme in themes"
                :key="theme.value"
                type="button"
                class="opt-card theme-card"
                :class="{ selected: colorScheme === theme.value }"
                @click="setColorScheme(theme.value)"
              >
                <span class="theme-preview" :class="`theme-preview--${theme.value}`" aria-hidden="true">
                  <template v-if="theme.value === 'system'">
                    <span class="theme-half theme-half--light">
                      <span class="theme-side" />
                      <span class="theme-lines"><span /><span /><span /></span>
                    </span>
                    <span class="theme-half theme-half--dark">
                      <span class="theme-side" />
                      <span class="theme-lines"><span /><span /><span /></span>
                    </span>
                  </template>
                  <template v-else>
                    <span class="theme-side" />
                    <span class="theme-lines"><span /><span /><span /></span>
                  </template>
                </span>
                <span class="opt-label">{{ theme.label }}</span>
              </button>
            </div>
          </div>

          <div class="pref-group">
            <div class="pref-label">{{ t('theme.accentLabel') }}</div>
            <div class="accent-cards">
              <button
                v-for="option in accents"
                :key="option.value"
                type="button"
                class="opt-card accent-card"
                :class="{ selected: accent === option.value }"
                @click="setAccent(option.value)"
              >
                <span class="opt-radio" :class="{ on: accent === option.value }" />
                <span class="accent-swatch" :class="`accent-swatch--${option.value}`" aria-hidden="true" />
                <span class="opt-label">{{ option.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="wiz-foot">
        <Button variant="primary" size="lg" class="wiz-primary" @click="emit('complete')">
          {{ t('onboarding.start') }}
        </Button>
        <Button variant="ghost" @click="emit('skip')">{{ t('onboarding.skip') }}</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-ui);
}
.wiz-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: min(560px, 100%);
  margin: 0 auto;
  padding: max(var(--space-8), 12vh) var(--space-5) var(--space-6);
}
.wiz-step {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  flex-direction: column;
  align-items: center;
}
.wiz-step-fill {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  flex-direction: column;
  justify-content: center;
}
.wiz-title {
  margin: var(--space-4) 0 0;
  color: var(--color-text);
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  text-align: center;
}
.wiz-sub {
  max-width: 460px;
  margin: var(--space-2) 0 var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  text-align: center;
}
.pref-group { width: 100%; margin-bottom: var(--space-5); }
.pref-label {
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}
.theme-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); width: 100%; }
.accent-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); width: 100%; }
.opt-card {
  display: flex;
  align-items: center;
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}
.opt-card:hover { border-color: var(--color-line-strong); }
.opt-card:focus-visible { outline: none; box-shadow: var(--p-focus-ring-strong); }
.opt-card.selected { border-color: var(--color-accent); background: var(--color-accent-soft); }
.opt-label { color: var(--color-text); font-size: var(--text-base); font-weight: var(--weight-medium); }
.theme-card { flex-direction: column; gap: var(--space-3); padding: var(--space-3); }
.theme-preview {
  display: flex;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-md);
}
.theme-preview--light { background: var(--surface-light); }
.theme-preview--dark { background: var(--surface-dark); }
.theme-half { display: flex; flex: 1; min-width: 0; }
.theme-half--light { background: var(--surface-light); }
.theme-half--dark { background: var(--surface-dark); }
.theme-side { width: 30%; flex: none; background: color-mix(in srgb, currentColor 7%, transparent); }
.theme-preview--dark .theme-side,
.theme-half--dark .theme-side { background: color-mix(in srgb, var(--surface-light) 8%, transparent); }
.theme-lines { display: flex; flex: 1; flex-direction: column; gap: 6px; padding: 14% 12%; }
.theme-lines span { height: 6px; border-radius: var(--radius-full); background: color-mix(in srgb, currentColor 16%, transparent); }
.theme-preview--dark .theme-lines span,
.theme-half--dark .theme-lines span { background: color-mix(in srgb, var(--surface-light) 22%, transparent); }
.theme-lines span:nth-child(1) { width: 62%; }
.theme-lines span:nth-child(2) { width: 88%; }
.theme-lines span:nth-child(3) { width: 44%; }
.accent-card { gap: var(--space-3); padding: var(--space-4); }
.opt-radio {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: var(--p-hairline) solid var(--color-line-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
}
.opt-radio::after { width: 8px; height: 8px; border-radius: var(--radius-full); background: transparent; content: '' ; }
.opt-radio.on { border-color: var(--color-accent); }
.opt-radio.on::after { background: var(--color-accent); }
.accent-swatch { width: 14px; height: 14px; border-radius: var(--radius-full); }
.accent-swatch--blue { background: var(--accent-primary); }
.accent-swatch--mono { background: var(--color-text); }
.wiz-foot {
  display: flex;
  width: 100%;
  margin-top: auto;
  padding: var(--space-8) 0 max(var(--space-8), 8vh);
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}
.wiz-primary { min-width: 140px; }
@media (max-width: 640px) {
  .theme-cards,
  .accent-cards { grid-template-columns: 1fr; }
}
</style>
