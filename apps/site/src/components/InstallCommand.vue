<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { INSTALL_CHANNELS } from '../install-channels';

const root = ref(null);
const trigger = ref(null);
const selectedId = ref(/Win/i.test(navigator.platform || navigator.userAgent) ? 'windows' : 'unix');
const open = ref(false);
const copied = ref(false);
const activeChannel = computed(() => INSTALL_CHANNELS.find((channel) => channel.id === selectedId.value));
let resetTimer;

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const didCopy = document.execCommand('copy');
  textarea.remove();
  return didCopy;
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(activeChannel.value.command);
  } catch {
    if (!fallbackCopy(activeChannel.value.command)) return;
  }

  copied.value = true;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copied.value = false;
  }, 1600);
}

function optionButtons() {
  return [...root.value.querySelector('[role="listbox"]').querySelectorAll('[role="option"]')];
}

async function openMenu() {
  open.value = true;
  await nextTick();
  optionButtons().find((option) => option.getAttribute('aria-selected') === 'true')?.focus();
}

function closeMenu(restoreFocus = true) {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) nextTick(() => trigger.value?.focus());
}

function toggleMenu() {
  if (open.value) closeMenu();
  else openMenu();
}

function selectChannel(id) {
  selectedId.value = id;
  closeMenu();
}

function onTriggerKeydown(event) {
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    openMenu();
  }
}

function onMenuKeydown(event) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const options = optionButtons();
  const current = options.indexOf(document.activeElement);
  const offset = event.key === 'ArrowDown' ? 1 : -1;
  options[(current + offset + options.length) % options.length].focus();
}

function onDocumentPointerdown(event) {
  if (!root.value?.contains(event.target)) closeMenu();
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerdown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onUnmounted(() => {
  clearTimeout(resetTimer);
  document.removeEventListener('pointerdown', onDocumentPointerdown);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div ref="root" class="install-options">
    <div class="install-input">
      <button
        ref="trigger"
        class="install-trigger"
        type="button"
        aria-haspopup="listbox"
        :aria-expanded="open"
        aria-controls="install-menu"
        @click="toggleMenu"
        @keydown="onTriggerKeydown"
      >
        <img src="/brand/pythinker_animated.svg" alt="" width="16" height="20">
        Pick your OS
        <svg aria-hidden="true" viewBox="0 0 12 8"><path d="m1 1 5 5 5-5" /></svg>
      </button>
      <code>{{ activeChannel.command }}</code>
      <button class="copy-button" type="button" :aria-label="copied ? 'Copied' : 'Copy install command'" @click="copyCommand">
        <svg v-if="copied" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
        <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
      </button>
      <span class="visually-hidden" aria-live="polite">{{ copied ? 'Copied' : '' }}</span>
    </div>

    <Transition name="install-menu">
      <div v-show="open" id="install-menu" class="install-menu" role="listbox" @keydown="onMenuKeydown">
        <button
          v-for="channel in INSTALL_CHANNELS"
          :key="channel.id"
          class="install-option"
          type="button"
          role="option"
          :aria-selected="selectedId === channel.id"
          @click="selectChannel(channel.id)"
        >
          <span class="channel-label">
            <img v-if="channel.icon" :src="channel.icon" alt="" width="16" height="16" />
            <svg v-else class="terminal-glyph" aria-hidden="true" viewBox="0 0 16 16"><path d="m2 4 3 3-3 3M7 11h6" /></svg>
            {{ channel.label }}
          </span>
          <svg v-if="selectedId === channel.id" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
        </button>
        <div class="install-divider" role="separator"></div>
        <a href="https://github.com/Pythoughts-labs/pythinker-code" target="_blank" rel="noopener">
          <span class="channel-label"><img src="/brand/github.svg" alt="" width="16" height="16" />GitHub repository</span>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
        </a>
        <a href="https://www.npmjs.com/package/@pythoughts/pythinker-code" target="_blank" rel="noopener">
          <span class="channel-label"><img src="/brand/npm.svg" alt="" width="16" height="16" />npm package</span>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
        </a>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.install-options {
  position: relative;
  width: 100%;
  max-width: 720px;
}

.install-input {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  background: var(--canvas);
}

.install-trigger {
  display: inline-flex;
  min-height: 44px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--pill-dark);
  color: var(--pill-dark-ink);
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
}

.install-trigger img {
  width: 16px;
  height: 20px;
  flex: 0 0 auto;
}

.install-trigger svg {
  width: 12px;
  height: 8px;
}

.install-input code {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--ink);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-button {
  position: relative;
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  margin-left: auto;
  padding: 12px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  opacity: 0.7;
}

.copy-button:hover {
  color: var(--ink);
  opacity: 1;
}

.copy-button::before {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  content: '';
}

.copy-button:hover::before {
  background: var(--surface-2);
}

.copy-button svg {
  position: relative;
  width: 20px;
  height: 20px;
}

svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.install-menu {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 210px;
  padding: 6px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--canvas);
  box-shadow: var(--shadow-card);
}

.install-option,
.install-menu a {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
}

.install-option:hover,
.install-option[aria-selected='true'],
.install-menu a:hover {
  background: var(--surface-2);
}

.install-option svg,
.install-menu a svg {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  color: var(--accent);
}

.install-menu a svg {
  color: var(--accent);
}

.channel-label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.channel-label img,
.terminal-glyph {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.channel-label img {
  filter: opacity(0.75);
}

.terminal-glyph {
  color: var(--ink-muted);
}

.install-divider {
  height: 1px;
  margin: 6px 8px;
  background: var(--hairline);
}

.install-menu-enter-active,
.install-menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.install-menu-enter-from,
.install-menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (max-width: 640px) {
  .install-input {
    gap: 8px;
  }

  .install-trigger {
    padding-inline: 16px;
  }

  .install-input code {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .install-menu-enter-active,
  .install-menu-leave-active {
    transition: none;
  }
}
</style>
