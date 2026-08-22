<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useAppearance, type Accent, type ColorScheme } from '../../composables/client/useAppearance';
import PythinkerLogo from '../PythinkerLogo.vue';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';

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
    <div class="wiz-rail">
      <div class="rail-inner">
        <span class="eyebrow-pill">{{ t('onboarding.eyebrow') }}</span>

        <div class="brand-tile">
          <PythinkerLogo size="lg" :animated="false" label="Pythinker Code" />
        </div>

        <h1 class="wiz-title">{{ t('onboarding.title') }}</h1>
        <p class="wiz-sub">{{ t('onboarding.subtitle') }}</p>

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

        <div class="wiz-actions">
          <Button variant="primary" size="lg" class="wiz-action" data-testid="onboarding-complete" @click="emit('complete')">
            <span>{{ t('onboarding.start') }}</span>
            <Icon name="arrow-right" size="sm" />
          </Button>
          <Button variant="secondary" size="lg" class="wiz-action" data-testid="onboarding-skip" @click="emit('skip')">
            <span>{{ t('onboarding.skip') }}</span>
            <Icon name="arrow-right" size="sm" />
          </Button>
        </div>

        <p class="wiz-hint">{{ t('onboarding.hint') }}</p>
      </div>
    </div>

    <aside class="wiz-hero" aria-hidden="true">
      <div class="hero-ambient">
        <span class="orb orb-a" />
        <span class="orb orb-b" />
        <span class="orb orb-c" />
      </div>

      <div class="hero-inner">
        <PythinkerLogo size="hero" :animated="false" label="" />
        <p class="hero-tagline">{{ t('onboarding.heroTitle') }}</p>
        <p class="hero-sub">{{ t('onboarding.heroSub') }}</p>

        <div class="frost-stage">
          <figure class="frost-card">
            <span class="mock-bar">
              <span class="mac-dots"><i class="dot-r" /><i class="dot-y" /><i class="dot-g" /></span>
            </span>
            <span class="mock-body">
              <span class="mock-side"><i /><i /><i /></span>
              <span class="mock-main"><i class="w-62" /><i class="w-88" /><i class="w-45" /><i class="w-74" /></span>
            </span>
            <figcaption>{{ t('onboarding.platformMac') }}</figcaption>
          </figure>

          <figure class="frost-card">
            <span class="mock-bar">
              <span class="win-controls"><i class="c-min" /><i class="c-max" /><i class="c-x" /></span>
            </span>
            <span class="mock-body">
              <span class="mock-side"><i /><i /><i /></span>
              <span class="mock-main"><i class="w-74" /><i class="w-52" /><i class="w-88" /><i class="w-62" /></span>
            </span>
            <figcaption>{{ t('onboarding.platformWindows') }}</figcaption>
          </figure>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.wizard {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  overflow-y: auto;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-ui);
}

/* Left rail */
.wiz-rail { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.rail-inner {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  margin: auto;
  padding: max(var(--space-8), 8vh) var(--space-6);
}
.eyebrow-pill {
  align-self: flex-start;
  padding: var(--space-1) var(--space-3);
  border: var(--p-hairline) solid var(--color-line-strong);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.04em;
}
.brand-tile {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-top: var(--space-8);
  border-radius: var(--radius-xl);
  background: var(--color-text);
  color: var(--color-bg);
}
.brand-tile :deep(svg), .brand-tile :deep(.pythinker-logo) { color: var(--color-bg); }
.wiz-title {
  margin: var(--space-5) 0 0;
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
}
.wiz-sub { max-width: 400px; margin: var(--space-2) 0 0; color: var(--color-text-muted); font-size: var(--text-base); line-height: var(--leading-normal); }

.pref-group { margin-top: var(--space-6); }
.pref-label { margin-bottom: var(--space-2); color: var(--color-text-faint); font-size: var(--text-xs); font-weight: var(--weight-medium); letter-spacing: 0.06em; text-transform: uppercase; }
.theme-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); width: 100%; }
.accent-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); width: 100%; }
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
.opt-label { color: var(--color-text); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.theme-card { flex-direction: column; gap: var(--space-2); padding: var(--space-2); }
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
.accent-card { gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.opt-radio {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: var(--p-hairline) solid var(--color-line-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
}
.opt-radio::after { width: 7px; height: 7px; border-radius: var(--radius-full); background: transparent; content: ''; }
.opt-radio.on { border-color: var(--color-accent); }
.opt-radio.on::after { background: var(--color-accent); }
.accent-swatch { width: 12px; height: 12px; flex: none; border-radius: var(--radius-full); }
.accent-swatch--blue { background: var(--accent-primary); }
.accent-swatch--mono { background: var(--color-text); }

/* Action rows */
.wiz-actions { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-8); }
.wiz-action { width: 100%; }
.wiz-actions .wiz-action:first-child { height: 48px; }
.wiz-actions :deep(.ui-button) { font-size: var(--text-base); }
.wiz-actions :deep(.ui-button__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
}
.wiz-hint { margin: var(--space-3) 0 0; color: var(--color-text-faint); font-size: var(--text-xs); line-height: var(--leading-normal); }

/* Right hero — branded banner.
   Glassmorphism here extends the sanctioned TopBar `.frost` pattern by explicit
   product decision; every frost surface keeps the same recipe: translucent
   surface color-mix + backdrop blur + hairline border. */
.wiz-hero {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: min(44vw, 560px);
  margin: max(var(--space-6), 3vh);
  overflow: hidden;
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-2xl);
  background: var(--color-surface);
}

.hero-ambient { position: absolute; inset: 0; z-index: 0; }
.orb {
  position: absolute;
  border-radius: var(--radius-full);
  filter: blur(72px);
}
.orb-a {
  width: 46%;
  aspect-ratio: 1;
  left: -12%;
  top: -14%;
  background: color-mix(in srgb, var(--accent-primary) 42%, transparent);
}
.orb-b {
  width: 40%;
  aspect-ratio: 1;
  right: -10%;
  bottom: 6%;
  background: color-mix(in srgb, var(--color-success) 30%, transparent);
}
.orb-c {
  width: 34%;
  aspect-ratio: 1;
  left: 24%;
  bottom: -16%;
  background: color-mix(in srgb, var(--color-warning) 26%, transparent);
}

.hero-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: var(--space-8) var(--space-6);
  text-align: center;
}
.hero-inner > .pythinker-logo { animation: hero-float 6s var(--ease-out) infinite alternate; }
@keyframes hero-float {
  from { transform: translateY(-4px); }
  to { transform: translateY(4px); }
}
.hero-tagline {
  margin: var(--space-5) 0 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text);
}
.hero-sub { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--text-sm); line-height: var(--leading-normal); }

.frost-stage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  width: 100%;
  max-width: 380px;
  margin-top: var(--space-6);
}
.frost-card {
  display: flex;
  flex-direction: column;
  margin: 0;
  overflow: hidden;
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-surface) 58%, transparent);
  -webkit-backdrop-filter: saturate(160%) blur(20px);
  backdrop-filter: saturate(160%) blur(20px);
  box-shadow: var(--shadow-menu);
  transition: transform var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}
.frost-card:hover { transform: translateY(-3px); border-color: var(--color-line-strong); }
.mock-bar {
  display: flex;
  align-items: center;
  height: var(--space-5);
  padding: 0 var(--space-2);
  border-bottom: var(--p-hairline) solid var(--color-line);
  background: color-mix(in srgb, var(--color-text) 3%, transparent);
}
.mac-dots { display: inline-flex; gap: 5px; }
.mac-dots i { width: 9px; height: 9px; border-radius: var(--radius-full); }
.dot-r { background: var(--color-danger); }
.dot-y { background: var(--color-warning); }
.dot-g { background: var(--color-success); }
.win-controls { display: inline-flex; gap: var(--space-2); margin-left: auto; color: var(--color-text-faint); }
.c-min,
.c-max,
.c-x { position: relative; width: 9px; height: 9px; }
.c-min::after {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 1px;
  height: 1.5px;
  background: currentColor;
  content: '';
}
.c-max::after {
  box-sizing: border-box;
  position: absolute;
  inset: 1px;
  border: 1.5px solid currentColor;
  border-radius: var(--radius-sm);
  content: '';
}
.c-x::before,
.c-x::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 11px;
  height: 1.5px;
  background: currentColor;
  content: '';
}
.c-x::before { transform: translate(-50%, -50%) rotate(45deg); }
.c-x::after { transform: translate(-50%, -50%) rotate(-45deg); }
.mock-body { display: flex; width: 100%; aspect-ratio: 16 / 10; }
.mock-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  width: 30%;
  flex: none;
  padding: var(--space-2) var(--space-1-5);
  border-right: var(--p-hairline) solid var(--color-line);
}
.mock-side i { height: 5px; border-radius: var(--radius-full); background: color-mix(in srgb, var(--color-text) 12%, transparent); }
.mock-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.mock-main i { height: 6px; border-radius: var(--radius-full); background: color-mix(in srgb, var(--color-text) 16%, transparent); }
.mock-main .w-88 { width: 88%; }
.mock-main .w-74 { width: 74%; }
.mock-main .w-62 { width: 62%; }
.mock-main .w-52 { width: 52%; }
.mock-main .w-45 { width: 45%; }
.frost-card figcaption {
  padding: var(--space-1-5) 0 var(--space-2);
  border-top: var(--p-hairline) solid var(--color-line);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

@media (max-width: 960px) {
  .wiz-hero { display: none; }
  .rail-inner { margin: 0 auto; }
}
@media (max-width: 640px) {
  .theme-cards,
  .accent-cards { grid-template-columns: 1fr; }
  .rail-inner { padding: var(--space-6) var(--space-5); }
}
@media (prefers-reduced-motion: reduce) {
  .opt-card { transition: none; }
  .frost-card { transition: none; }
  .frost-card:hover { transform: none; }
  .hero-inner > .pythinker-logo { animation: none; }
}
</style>
