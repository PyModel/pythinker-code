<script setup lang="ts">
import '@xterm/xterm/css/xterm.css';

import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import type { Terminal as XTerm, ITheme } from '@xterm/xterm';
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIsDark } from '../composables/useIsDark';
import { useTerminal } from '../composables/useTerminal';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';

const props = defineProps<{ sessionId: string }>();

// xterm's `fontFamily` is a literal font string — it does NOT resolve CSS
// variables, so passing `var(--mono)` silently fell back to xterm's default
// (courier), which is why glyph metrics / spacing looked off. Use the real
// JetBrains Mono stack (same family the app loads via @fontsource).
const TERMINAL_FONT =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const hostRef = ref<HTMLElement | null>(null);
const sessionId = toRef(props, 'sessionId');
const terminalClient = useTerminal(sessionId);
const isDark = useIsDark();
const { t } = useI18n();

let term: XTerm | null = null;
let fitAddon: FitAddonType | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let disposeOutput: (() => void) | null = null;
let disposeExit: (() => void) | null = null;

const theme = computed<ITheme>(() => {
  if (isDark.value) {
    return {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#7aa2ff',
      selectionBackground: '#264f78',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#f2cc60',
      blue: '#7aa2ff',
      magenta: '#d2a8ff',
      cyan: '#76e3ea',
      white: '#e6edf3',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#1f6feb',
    selectionBackground: '#c8e1ff',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#f6f8fa',
  };
});

function fitAndResize(): void {
  if (!term || !fitAddon || !hostRef.value) return;
  if (hostRef.value.clientWidth <= 0 || hostRef.value.clientHeight <= 0) return;
  try {
    fitAddon.fit();
    terminalClient.resize(term.cols, term.rows);
  } catch {
    // xterm-fit can throw while layout is settling; the next resize retries.
  }
}

function scheduleFit(): void {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    fitAndResize();
  }, 100);
}

async function initTerminal(): Promise<void> {
  if (!hostRef.value || term) return;
  const [{ Terminal: XTermCtor }, { FitAddon: FitAddonCtor }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]);
  // Wait for the variable font to load before xterm measures the cell — a
  // not-yet-loaded webfont makes xterm cache a wrong char width, leaving the
  // text looking loosely/unevenly spaced until a resize.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // fonts API unavailable — proceed with the fallback metric
    }
  }
  const next = new XTermCtor({
    cursorBlink: true,
    convertEol: true,
    fontFamily: TERMINAL_FONT,
    fontSize: 13,
    lineHeight: 1.1,
    letterSpacing: 0,
    scrollback: 4000,
    theme: theme.value,
  });
  const fit = new FitAddonCtor();
  next.loadAddon(fit);
  next.open(hostRef.value);
  next.onData((data) => terminalClient.write(data));
  next.onResize(({ cols, rows }) => terminalClient.resize(cols, rows));
  term = next;
  fitAddon = fit;

  disposeOutput = terminalClient.onOutput((data) => {
    term?.write(data);
  });
  disposeExit = terminalClient.onExit((exitCode) => {
    term?.writeln('');
    term?.writeln(exitCode === null
      ? t('terminal.processExited')
      : t('terminal.processExitedWithCode', { code: exitCode }));
  });

  resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(hostRef.value);
}

async function start(): Promise<void> {
  await nextTick();
  await initTerminal();
  fitAndResize();
  await terminalClient.start({ cols: term?.cols, rows: term?.rows });
  fitAndResize();
  term?.focus();
}

function restart(): void {
  term?.reset();
  term?.focus();
  void terminalClient.restart({ cols: term?.cols, rows: term?.rows });
}

function selectTab(id: string): void {
  term?.reset();
  terminalClient.selectTab(id);
  term?.focus();
}

function closeTab(id: string): void {
  if (id === terminalClient.activeTerminalId.value) term?.reset();
  void terminalClient.close(id);
}

function newTab(): void {
  term?.reset();
  void terminalClient.newTab({ cols: term?.cols, rows: term?.rows });
}

onMounted(() => {
  void start();
});

watch(theme, (nextTheme) => {
  if (term) term.options.theme = nextTheme;
});

watch(sessionId, () => {
  term?.reset();
  if (sessionId.value) void start();
});

watch(terminalClient.activeTerminalId, () => {
  term?.reset();
  fitAndResize();
});

onUnmounted(() => {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeObserver?.disconnect();
  disposeOutput?.();
  disposeExit?.();
  term?.dispose();
  term = null;
  fitAddon = null;
});
</script>

<template>
  <section class="terminal-pane">
    <div class="terminal-toolbar">
      <div class="terminal-tabs" role="tablist" :aria-label="t('terminal.toolbarAria')">
        <span class="terminal-dot" :class="{ on: terminalClient.connected.value }"></span>
        <button
          v-for="item in terminalClient.terminals.value"
          :key="item.id"
          class="terminal-tab"
          :class="{ active: item.id === terminalClient.activeTerminalId.value }"
          type="button"
          role="tab"
          :aria-selected="item.id === terminalClient.activeTerminalId.value"
          :tabindex="item.id === terminalClient.activeTerminalId.value ? 0 : -1"
          @click="selectTab(item.id)"
        >
          <span>{{ item.shell.split('/').at(-1) }}</span>
          <span
            class="terminal-tab-close"
            role="button"
            tabindex="-1"
            :aria-label="t('terminal.closeTab')"
            @click.stop="closeTab(item.id)"
          >×</span>
        </button>
        <IconButton size="sm" :label="t('terminal.newTab')" @click="newTab"><Icon name="plus" /></IconButton>
      </div>
      <div class="terminal-actions">
        <IconButton size="sm" :label="t('terminal.restartTab')" :disabled="!terminalClient.terminal.value" @click="restart"><Icon name="undo" /></IconButton>
      </div>
    </div>
    <div class="terminal-surface">
      <div ref="hostRef" class="terminal-host"></div>
      <button v-if="!terminalClient.loading.value && terminalClient.terminals.value.length === 0" class="terminal-overlay terminal-empty" type="button" @click="newTab">{{ t('terminal.empty') }}</button>
      <div v-else-if="terminalClient.loading.value" class="terminal-overlay">{{ t('terminal.starting') }}</div>
      <div v-else-if="terminalClient.error.value" class="terminal-overlay error">{{ terminalClient.error.value }}</div>
    </div>
  </section>
</template>

<style scoped>
.terminal-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.terminal-toolbar {
  flex: none;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px 5px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.terminal-tabs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--dim);
  font-family: var(--mono);
  font-size: var(--text-base);
}
.terminal-tab {
  min-height: 26px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  cursor: pointer;
}
.terminal-tab:hover { background: var(--color-hover); color: var(--color-text); }
.terminal-tab:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.terminal-tab.active { background: var(--color-selected); color: var(--color-text); }
.terminal-tab-close { color: var(--color-text-faint); font-size: var(--text-lg); line-height: 1; }
.terminal-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
  flex: none;
}
.terminal-dot.on {
  background: var(--color-success);
}
.terminal-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}
.terminal-surface {
  position: relative;
  flex: 1;
  min-height: 0;
}
.terminal-host {
  position: absolute;
  inset: 0;
  padding: 8px;
}
.terminal-host :deep(.xterm) {
  height: 100%;
}
.terminal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  text-align: center;
}
.terminal-overlay.error {
  color: var(--color-danger);
}
.terminal-empty { border: 0; cursor: pointer; }
.terminal-empty:focus-visible { outline: none; box-shadow: inset var(--p-focus-ring); }
</style>
