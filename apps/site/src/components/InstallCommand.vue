<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { INSTALL_CHANNELS } from '../install-channels';

const root = ref(null);
const trigger = ref(null);
const selectedId = ref(/Win/i.test(navigator.platform || navigator.userAgent) ? 'windows' : 'unix');
const open = ref(false);
const copied = ref(false);
const activeChannel = computed(() => INSTALL_CHANNELS.find((channel) => channel.id === selectedId.value) || INSTALL_CHANNELS[0]);
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
  }, 1800);
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
        <span class="channel-indicator">
          <img v-if="activeChannel.icon" :src="activeChannel.icon" alt="" width="16" height="16" class="channel-current-icon" />
          <svg v-else class="terminal-glyph" aria-hidden="true" viewBox="0 0 16 16"><path d="m2 4 3 3-3 3M7 11h6" /></svg>
          <span class="trigger-label">{{ activeChannel.label }}</span>
        </span>
        <svg class="chevron-icon" :class="{ 'is-open': open }" aria-hidden="true" viewBox="0 0 12 8">
          <path d="m1 1 5 5 5-5" />
        </svg>
      </button>
      
      <code class="command-text" :title="activeChannel.command">{{ activeChannel.command }}</code>
      
      <button 
        class="copy-button" 
        :class="{ 'is-copied': copied }"
        type="button" 
        :aria-label="copied ? 'Copied to clipboard' : 'Copy install command'" 
        @click="copyCommand"
      >
        <Transition name="icon-fade" mode="out-in">
          <svg v-if="copied" key="check" class="check-icon" aria-hidden="true" viewBox="0 0 20 20">
            <path d="m4 10 4 4 8-9" />
          </svg>
          <svg v-else key="copy" aria-hidden="true" viewBox="0 0 20 20">
            <rect x="7" y="3" width="10" height="11" rx="2" />
            <rect x="3" y="7" width="10" height="10" rx="2" />
          </svg>
        </Transition>
        <span class="copy-tooltip" :class="{ 'is-visible': copied }">{{ copied ? 'Copied!' : 'Copy' }}</span>
      </button>
      <span class="visually-hidden" aria-live="polite">{{ copied ? 'Copied command to clipboard' : '' }}</span>
    </div>

    <Transition name="install-menu">
      <div v-show="open" id="install-menu" class="install-menu" role="listbox" @keydown="onMenuKeydown">
        <div class="menu-label">Select Package Channel</div>
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
          <svg v-if="selectedId === channel.id" class="check-mark" aria-hidden="true" viewBox="0 0 20 20">
            <path d="m4 10 4 4 8-9" />
          </svg>
        </button>
        <div class="install-divider" role="separator"></div>
        <a href="https://github.com/PyModel/pythinker-code" target="_blank" rel="noopener" class="menu-link">
          <span class="channel-label"><img src="/brand/github.svg" alt="" width="16" height="16" />GitHub repository</span>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
        </a>
        <a href="https://www.npmjs.com/package/@pymodel/pythinker-code" target="_blank" rel="noopener" class="menu-link">
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
  padding: 6px 8px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-pill);
  background: var(--canvas);
  box-shadow: 0 4px 20px -4px rgba(10, 10, 12, 0.07);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.install-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 4px 24px -2px var(--accent-glow);
}

.install-trigger {
  display: inline-flex;
  min-height: 42px;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: var(--pill-dark);
  color: var(--pill-dark-ink);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 140ms ease;
}

.install-trigger:hover {
  background: #27272a;
}

.channel-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.channel-current-icon {
  width: 16px;
  height: 16px;
  filter: brightness(0) invert(1);
}

.trigger-label {
  font-weight: 600;
}

.chevron-icon {
  width: 10px;
  height: 6px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 150ms ease;
}

.chevron-icon.is-open {
  transform: rotate(180deg);
}

.command-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--ink);
  font-family: 'Geist Mono', 'JetBrains Mono', monospace;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-inline: 6px;
}

.copy-button {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  margin-left: auto;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 50%;
  background: var(--surface-1);
  color: var(--ink-muted);
  cursor: pointer;
  place-items: center;
  transition: all 140ms ease;
}

.copy-button:hover {
  color: var(--ink);
  background: var(--surface-2);
  border-color: var(--hairline-strong);
}

.copy-button.is-copied {
  background: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}

.copy-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.copy-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 4px 8px;
  border-radius: 6px;
  background: #09090b;
  color: #ffffff;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 140ms ease, transform 140ms ease;
}

.copy-tooltip.is-visible,
.copy-button:hover .copy-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.install-menu {
  position: absolute;
  z-index: 30;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 240px;
  padding: 8px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--canvas);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(16px);
}

.menu-label {
  padding: 6px 10px;
  color: var(--ink-subtle);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.install-option,
.menu-link {
  display: flex;
  width: 100%;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  transition: background-color 100ms ease;
}

.install-option:hover,
.install-option[aria-selected='true'],
.menu-link:hover {
  background: var(--surface-2);
}

.install-option[aria-selected='true'] {
  font-weight: 600;
  color: var(--accent);
}

.channel-label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.channel-label img,
.terminal-glyph {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.terminal-glyph {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  color: var(--ink-muted);
}

.check-mark {
  width: 16px;
  height: 16px;
  stroke: var(--accent);
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.install-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--hairline);
}

.menu-link svg {
  width: 14px;
  height: 14px;
  stroke: var(--ink-subtle);
  stroke-width: 1.5;
  fill: none;
}

.install-menu-enter-active,
.install-menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.install-menu-enter-from,
.install-menu-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.icon-fade-enter-active,
.icon-fade-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}

.icon-fade-enter-from,
.icon-fade-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (max-width: 640px) {
  .install-input {
    gap: 8px;
    padding: 6px;
  }

  .install-trigger {
    padding: 6px 12px;
    font-size: 13px;
  }

  .command-text {
    font-size: 13px;
  }
}
</style>
