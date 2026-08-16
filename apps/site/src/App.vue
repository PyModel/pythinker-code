<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import AgentLoop from './components/AgentLoop.vue';
import InstallCommand from './components/InstallCommand.vue';
import LegacyDownloadsPopup from './components/LegacyDownloadsPopup.vue';
import ParticleField from './components/ParticleField.vue';
import PythinkerMascot from './components/PythinkerMascot.vue';

const version = __PYTHINKER_VERSION__;

// Desktop builds ship under their own git tag, so the repository's default "latest release"
// URL resolves to the CLI release instead. Bump this when a new desktop version is published.
const DESKTOP_VERSION = '0.1.0';
const DESKTOP_RELEASE_URL = `https://github.com/PyModel/pythinker-code/releases/tag/v${DESKTOP_VERSION}`;
const DESKTOP_DOWNLOADS = [
  {
    id: 'mac',
    label: 'Download for macOS',
    note: 'Apple Silicon · .dmg',
    icon: '/brand/apple.svg',
    href: `https://github.com/PyModel/pythinker-code/releases/download/v${DESKTOP_VERSION}/Pythinker-${DESKTOP_VERSION}-arm64.dmg`,
  },
  {
    id: 'windows',
    label: 'Download for Windows',
    note: 'x64 · installer',
    icon: '/brand/windows11.svg',
    href: `https://github.com/PyModel/pythinker-code/releases/download/v${DESKTOP_VERSION}/Pythinker-${DESKTOP_VERSION}-x64-Setup.exe`,
  },
];
const isWindows = /Win/i.test(navigator.platform || navigator.userAgent);
const desktopDownloads = isWindows ? [...DESKTOP_DOWNLOADS].reverse() : DESKTOP_DOWNLOADS;

const installRows = [
  ['macOS / Linux', 'curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash', '/brand/apple.svg'],
  ['Windows (PowerShell)', 'irm https://code.pythinker.com/pythinker-code/install.ps1 | iex', '/brand/windows11.svg'],
  ['Homebrew', 'brew install pymodel/tap/pythinker-code'],
  ['Nix', 'nix run github:PyModel/pythinker-code'],
  ['npm', 'npm install -g @pymodel/pythinker-code', '/brand/npm.svg'],
  ['Verify', 'pythinker --version'],
];

const features = [
  ['Subagents in parallel', 'Dispatch coder, explore, and plan subagents in isolated contexts from a single iterative loop. The agent reads results and keeps going until you are satisfied.'],
  ['ACP editor integration', 'Run pythinker acp and any Agent Client Protocol editor, including Zed and JetBrains, gets a full session inline.'],
  ['MCP tools', 'Load Model Context Protocol servers with /mcp-config. The same tools your other agents use just work.'],
  ['Skills and hooks', 'Reusable repo-local instructions via /skill, and lifecycle hooks to gate risky calls and wire automation.'],
  ['Bring your own model', 'Works out of the box with Pythinker models and is configurable for other compatible LLM APIs.'],
];

const terminalDemos = [
  {
    id: 'fix-tests',
    label: 'Fix tests',
    input: 'Fix the failing tests, keep the patch focused, and verify it.',
    output: [
      { icon: '●', tone: 'progress', text: 'Inspecting failures and affected files' },
      { icon: '●', tone: 'progress', text: 'Editing the smallest safe patch' },
      { icon: '✓', tone: 'success', text: '18 tests passed · 2 files changed' },
    ],
  },
  {
    id: 'tasks',
    label: '/tasks',
    input: '/tasks',
    output: [
      { icon: '●', tone: 'progress', text: '001 running · verify authentication flow' },
      { icon: '✓', tone: 'success', text: '002 complete · inspect regression' },
      { icon: '›', tone: 'command', text: '2 background tasks · 1 complete' },
    ],
  },
  {
    id: 'help',
    label: '/help',
    input: '/help',
    output: [
      { icon: '›', tone: 'command', text: '/model     switch the active model' },
      { icon: '›', tone: 'command', text: '/tasks     inspect background work' },
      { icon: '›', tone: 'command', text: 'Shift-Tab  cycle thinking effort' },
    ],
  },
];

const vscodeInstallCommand = 'code --install-extension pymodel.pythinker';

const copiedCommand = ref('');
const mobileMenu = ref(null);
const menuButton = ref(null);
const menuOpen = ref(false);
const activeTerminalDemo = ref(terminalDemos[0]);
const visibleTerminalLines = ref(0);
const terminalPlaying = ref(false);
let resetTimer;
let menuCloseTimer;
let terminalTimer;
let revealObserver;
let reducedMotionQuery;
let menuOpenedByHover = false;

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (!fallbackCopy(text)) return;
  }

  copiedCommand.value = text;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copiedCommand.value = '';
  }, 1600);
}

function clearTerminalPlayback() {
  clearTimeout(terminalTimer);
  terminalTimer = undefined;
}

function revealNextTerminalLine() {
  if (visibleTerminalLines.value >= activeTerminalDemo.value.output.length) {
    terminalPlaying.value = false;
    return;
  }

  const delay = visibleTerminalLines.value === 0 ? 420 : 720;
  terminalTimer = setTimeout(() => {
    visibleTerminalLines.value += 1;
    revealNextTerminalLine();
  }, delay);
}

function playTerminalDemo(id = activeTerminalDemo.value.id) {
  const demo = terminalDemos.find((candidate) => candidate.id === id);
  if (!demo) return;

  clearTerminalPlayback();
  activeTerminalDemo.value = demo;
  visibleTerminalLines.value = 0;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    visibleTerminalLines.value = demo.output.length;
    terminalPlaying.value = false;
    return;
  }

  terminalPlaying.value = true;
  revealNextTerminalLine();
}

function closeMenu(restoreFocus = true) {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  menuOpenedByHover = false;
  clearTimeout(menuCloseTimer);
  if (restoreFocus) menuButton.value?.focus();
}

function toggleMenu() {
  if (menuOpenedByHover) menuOpenedByHover = false;
  else if (menuOpen.value) closeMenu();
  else menuOpen.value = true;
}

function openMenuOnHover() {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  clearTimeout(menuCloseTimer);
  if (!menuOpen.value) menuOpenedByHover = true;
  menuOpen.value = true;
}

function closeMenuOnHover() {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  menuCloseTimer = setTimeout(() => closeMenu(), 150);
}

function onDocumentPointerdown(event) {
  if (!mobileMenu.value?.contains(event.target)) closeMenu();
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerdown);
  document.addEventListener('keydown', onDocumentKeydown);
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  playTerminalDemo();
  if (reducedMotionQuery.matches) return;

  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));
});

onUnmounted(() => {
  clearTimeout(resetTimer);
  clearTimeout(menuCloseTimer);
  clearTerminalPlayback();
  revealObserver?.disconnect();
  document.removeEventListener('pointerdown', onDocumentPointerdown);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <ParticleField />
  <nav class="site-nav" aria-label="Primary navigation">
    <div class="container nav-inner">
      <a href="/" class="nav-brand"><PythinkerMascot :width="26" :height="32" /><span>Pythinker Code</span></a>
      <div class="nav-actions">
        <div class="nav-links">
          <a href="#desktop">Desktop</a>
          <a href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener">Docs</a>
          <a href="https://github.com/PyModel/pythinker-code" target="_blank" rel="noopener"><img src="/brand/github.svg" alt="" width="16" height="16" />GitHub</a>
          <a href="https://www.npmjs.com/package/@pymodel/pythinker-code" target="_blank" rel="noopener"><img src="/brand/npm.svg" alt="" width="16" height="16" />npm</a>
        </div>
        <a class="button button-primary nav-cta" href="#install">Get started</a>
        <div ref="mobileMenu" class="mobile-menu" @mouseenter="openMenuOnHover" @mouseleave="closeMenuOnHover">
          <button ref="menuButton" class="menu-button" type="button" aria-label="Menu" aria-haspopup="true" :aria-expanded="menuOpen" @click="toggleMenu">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Transition name="mobile-menu">
            <div v-show="menuOpen" class="mobile-menu-panel">
              <a href="#desktop" @click="closeMenu(false)">Desktop</a>
              <a href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener" @click="closeMenu(false)">Docs</a>
              <a href="https://github.com/PyModel/pythinker-code" target="_blank" rel="noopener" @click="closeMenu(false)"><img src="/brand/github.svg" alt="" width="16" height="16" />GitHub</a>
              <a href="https://www.npmjs.com/package/@pymodel/pythinker-code" target="_blank" rel="noopener" @click="closeMenu(false)"><img src="/brand/npm.svg" alt="" width="16" height="16" />npm</a>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </nav>

  <main id="top">
    <header class="hero container">
      <div class="hero-copy">
        <PythinkerMascot class="hero-mascot" :width="164" :height="205" />
        <h1>Pythinker Code</h1>
        <p class="hero-accent">Think first, then code.</p>
        <p class="hero-lead">Pythinker Code is an open-source AI engineering agent. It reads your repo, edits files, runs commands, and iterates until the job is done — in a native desktop app, your terminal, or VS Code.</p>
        <div class="hero-download">
          <div class="hero-download-actions">
            <a
              v-for="(download, index) in desktopDownloads"
              :key="download.id"
              :class="index === 0 ? 'button button-primary' : 'button button-secondary'"
              :href="download.href"
              target="_blank"
              rel="noopener"
            >
              <img :src="download.icon" alt="" width="18" height="18" />
              {{ download.label }}
            </a>
          </div>
          <p class="hero-download-note">
            {{ desktopDownloads.map((download) => download.note).join(' · ') }} ·
            <a :href="DESKTOP_RELEASE_URL" target="_blank" rel="noopener">All downloads</a>
          </p>
        </div>
        <p class="hero-install-label">Or install the CLI</p>
        <div class="hero-install">
          <InstallCommand />
        </div>
        <p class="hero-caption">Free and open source. MIT licensed. macOS, Linux, and Windows.</p>
      </div>
    </header>

    <section id="desktop" class="section container desktop-showcase" aria-labelledby="desktop-title">
      <div class="desktop-showcase-media reveal">
        <video autoplay muted loop playsinline preload="metadata" poster="/pythinker_desktop.png" aria-label="Pythinker Desktop app">
          <source src="/pythinker_desktop.webm" type="video/webm" />
          <img src="/pythinker_desktop.webp" alt="Pythinker Desktop showing an AI coding session" />
        </video>
        <img class="desktop-showcase-still" src="/pythinker_desktop.webp" alt="Pythinker Desktop showing an AI coding session" />
      </div>
      <div class="desktop-showcase-copy reveal">
        <p class="eyebrow">Desktop app</p>
        <h2 id="desktop-title" class="display-md">Pythinker Desktop</h2>
        <p class="desktop-showcase-lead">The agent in a native macOS app, with sidebar sessions, live activity, and auto-updates.</p>
        <div class="desktop-showcase-actions">
          <a class="button button-primary" :href="desktopDownloads[0].href" target="_blank" rel="noopener">{{ desktopDownloads[0].label }}</a>
          <span class="desktop-showcase-note">Auto-updates included · macOS (Apple Silicon) and Windows (x64)</span>
        </div>
      </div>
    </section>

    <div class="works-with" aria-label="Works with leading AI models">
      <span class="works-with-label">Works with</span>
      <div class="works-with-marquee" aria-hidden="true">
        <div class="works-with-track">
          <img src="/brand/anthropic.svg" alt="Anthropic" class="works-with-logo" />
          <img src="/brand/openai.svg" alt="OpenAI" class="works-with-logo" />
          <img src="/brand/gemini.svg" alt="Google Gemini" class="works-with-logo" />
          <img src="/brand/ollama.svg" alt="Ollama" class="works-with-logo" />
          <img src="/brand/lmstudio.svg" alt="LM Studio" class="works-with-logo" />
          <img src="/brand/deepseek.svg" alt="DeepSeek" class="works-with-logo" />
          <img src="/brand/meta.svg" alt="Meta / Llama" class="works-with-logo" />
          <img src="/brand/mistral.svg" alt="Mistral" class="works-with-logo" />
          <img src="/brand/groq.svg" alt="Groq" class="works-with-logo works-with-logo--text" />
          <img src="/brand/aws.svg" alt="AWS" class="works-with-logo works-with-logo--text" />
          <img src="/brand/anthropic.svg" alt="" class="works-with-logo" />
          <img src="/brand/openai.svg" alt="" class="works-with-logo" />
          <img src="/brand/gemini.svg" alt="" class="works-with-logo" />
          <img src="/brand/ollama.svg" alt="" class="works-with-logo" />
          <img src="/brand/lmstudio.svg" alt="" class="works-with-logo" />
          <img src="/brand/deepseek.svg" alt="" class="works-with-logo" />
          <img src="/brand/meta.svg" alt="" class="works-with-logo" />
          <img src="/brand/mistral.svg" alt="" class="works-with-logo" />
          <img src="/brand/groq.svg" alt="" class="works-with-logo works-with-logo--text" />
          <img src="/brand/aws.svg" alt="" class="works-with-logo works-with-logo--text" />
        </div>
      </div>
    </div>

    <section id="vscode" class="section container" aria-labelledby="vscode-title">
      <div class="reveal">
        <p class="eyebrow">VS Code extension</p>
        <h2 id="vscode-title" class="display-md">The same agent, inside your editor.</h2>
      </div>
      <div class="vscode-grid">
        <figure class="vscode-shot reveal">
          <img
            src="/vscode_img.jpeg"
            alt="Pythinker Code running in the VS Code sidebar next to an open editor"
            width="1280"
            height="844"
            loading="lazy"
            decoding="async"
          />
        </figure>
        <div class="vscode-copy reveal">
          <p class="vscode-lead">Install from the Marketplace and Pythinker Code lives in the Activity Bar. It reads your repo, proposes edits in the native diff viewer, and runs commands with your approval.</p>
          <ul class="vscode-points">
            <li><strong>Native diffs.</strong> Review every proposed change in VS Code's own diff viewer before it lands.</li>
            <li><strong>Shared config.</strong> Same <code>config.toml</code>, MCP servers, login, and sessions as the terminal app.</li>
            <li><strong>Thinking controls.</strong> Toggle reasoning or pick a model-supported thinking effort per task.</li>
          </ul>
          <div class="vscode-actions">
            <a class="button button-primary" href="https://marketplace.visualstudio.com/items?itemName=pymodel.pythinker" target="_blank" rel="noopener">
              <img src="/brand/visualstudiocode.svg" alt="" width="16" height="16" />
              Get the extension
            </a>
            <div class="vscode-command">
              <code>code --install-extension pymodel.pythinker</code>
              <button class="row-copy" type="button" aria-label="Copy VS Code install command" @click="copyText(vscodeInstallCommand)">
                <svg v-if="copiedCommand === vscodeInstallCommand" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
                <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
              </button>
            </div>
          </div>
          <p class="section-note">Requires VS Code 1.100.0 or later. Cursor, Windsurf, and other VS Code forks install the same VSIX.</p>
        </div>
      </div>
    </section>

    <section id="install" class="section container" aria-labelledby="install-title">
      <div class="reveal">
        <p class="eyebrow">Installation</p>
        <h2 id="install-title" class="display-md">Every platform, one command.</h2>
      </div>
      <div class="command-list reveal">
        <div v-for="([platform, command, icon]) in installRows" :key="platform" class="command-row">
          <span class="platform-name">
            <img v-if="icon" :src="icon" alt="" width="16" height="16" />
            <svg v-else class="terminal-glyph" aria-hidden="true" viewBox="0 0 16 16"><path d="m2 4 3 3-3 3M7 11h6" /></svg>
            {{ platform }}
          </span>
          <code>{{ command }}</code>
          <button class="row-copy" type="button" :aria-label="`Copy ${platform} command`" @click="copyText(command)">
            <svg v-if="copiedCommand === command" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
            <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
          </button>
        </div>
      </div>
      <p class="section-note">Windows requires Git for Windows; Pythinker Code uses its bundled Git Bash as the shell. Every release artifact ships with a SHA-256 checksum.</p>
      <span class="visually-hidden" aria-live="polite">{{ copiedCommand ? 'Copied' : '' }}</span>
    </section>

    <section class="section container" aria-labelledby="quickstart-title">
      <div class="reveal">
        <p class="eyebrow">Quick start</p>
        <h2 id="quickstart-title" class="display-md">From install to first task in two minutes.</h2>
      </div>
      <div class="quickstart-grid">
        <div class="terminal-panel" aria-label="Interactive macOS-style Pythinker Code terminal demo">
          <div class="terminal-header">
            <div class="terminal-lights" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="terminal-title" aria-hidden="true">
              <span class="terminal-title-icon"><svg viewBox="0 0 16 16"><path d="m3 5 2.5 2.5L3 10M7 10h5" /></svg></span>
              <span>your-project — zsh</span>
            </div>
            <div class="terminal-window-actions">
              <span class="terminal-mode"><span aria-hidden="true"></span>YOLO mode</span>
              <button class="terminal-replay" type="button" :aria-label="terminalPlaying ? 'Restart terminal demo' : 'Replay terminal demo'" @click="playTerminalDemo()">
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 1 0 17 11M15.5 3v4h-4" /></svg>
              </button>
            </div>
          </div>
          <div class="terminal-body">
            <div class="terminal-session" aria-label="Launch commands">
              <div class="terminal-line shell-line"><span class="terminal-prompt" aria-hidden="true">%</span><code>cd your-project</code></div>
              <div class="terminal-line shell-line"><span class="terminal-prompt" aria-hidden="true">%</span><code>pythinker <strong class="terminal-flag">--yolo</strong></code></div>
            </div>
            <div class="terminal-yolo-note"><strong>YOLO</strong><span>Regular tool actions run without approval.</span></div>
            <div class="terminal-line terminal-user-line">
              <span class="terminal-prompt" aria-hidden="true">›</span>
              <code>{{ activeTerminalDemo.input }}</code>
            </div>
            <TransitionGroup tag="div" name="terminal-output" class="terminal-output" role="log" aria-live="polite">
              <div
                v-for="(line, index) in activeTerminalDemo.output.slice(0, visibleTerminalLines)"
                :key="activeTerminalDemo.id + '-' + index"
                class="terminal-output-line"
                :class="'is-' + line.tone"
              >
                <span class="terminal-output-marker" aria-hidden="true">{{ line.icon }}</span>
                <code>{{ line.text }}</code>
              </div>
            </TransitionGroup>
            <div v-if="!terminalPlaying && visibleTerminalLines === activeTerminalDemo.output.length" class="terminal-line terminal-ready-line">
              <span class="terminal-prompt" aria-hidden="true">›</span><span class="caret" aria-hidden="true"></span>
              <span class="visually-hidden">Ready for the next command</span>
            </div>
          </div>
          <div class="terminal-presets" aria-label="Terminal demo commands">
            <span class="terminal-presets-label">Try a command</span>
            <button
              v-for="demo in terminalDemos"
              :key="demo.id"
              class="terminal-preset"
              :class="{ 'is-active': activeTerminalDemo.id === demo.id }"
              type="button"
              :aria-pressed="activeTerminalDemo.id === demo.id"
              @click="playTerminalDemo(demo.id)"
            >
              {{ demo.label }}
            </button>
          </div>
        </div>
        <div class="quickstart-steps">
          <AgentLoop />
          <ol class="steps">
            <li><h3>Authenticate</h3><p>Run /login and choose Pythinker Code OAuth or an API key from the console.</p></li>
            <li><h3>Give it a task</h3><p>Refactor a module, trace a bug, scaffold a feature. The agent plans, executes tools, and iterates.</p></li>
            <li><h3>Stay in control</h3><p>Approval flows let you review every tool call before it runs, with a granular permission model.</p></li>
          </ol>
        </div>
      </div>
    </section>

    <section class="section container" aria-labelledby="features-title">
      <div class="reveal">
        <p class="eyebrow">Capabilities</p>
        <h2 id="features-title" class="display-md">Built for real engineering work.</h2>
      </div>
      <div class="feature-grid">
        <article v-for="([title, body], index) in features" :key="title" class="feature-card reveal" :class="{ lead: index === 0 }" :style="{ transitionDelay: `${Math.min(index, 4) * 80}ms` }">
          <h3>{{ title }}</h3>
          <p>{{ body }}</p>
          <div v-if="title === 'ACP editor integration'" class="feature-icons" aria-hidden="true">
            <img src="/brand/visualstudiocode.svg" alt="" width="16" height="16" />
            <img src="/brand/jetbrains.svg" alt="" width="16" height="16" />
          </div>
          <div v-else-if="title === 'MCP tools'" class="feature-icons" aria-hidden="true">
            <img src="/brand/mcp.svg" alt="" width="16" height="16" />
          </div>
        </article>
      </div>
    </section>

    <section class="section container" aria-labelledby="plugins-title">
      <div class="reveal">
        <p class="eyebrow">Plugin marketplace</p>
        <h2 id="plugins-title" class="display-md">Extend it from the marketplace.</h2>
      </div>
      <div class="plugin-list">
        <div class="plugin-row reveal">
          <p><strong>pythinker-datasource 3.2.0, official.</strong> Finance, macro, enterprise, academic, and legal data tools.</p>
          <code>/plugins install</code>
        </div>
        <div class="plugin-row reveal">
          <p><strong>superpowers 6.2.0, curated.</strong> Planning, TDD, debugging, and delivery workflows for coding agents.</p>
          <code>/plugins install</code>
        </div>
      </div>
      <p class="section-note">Marketplace is served from this domain and managed inside the CLI.</p>
    </section>

    <section class="section container" aria-labelledby="docs-title">
      <div class="reveal">
        <p class="eyebrow">Documentation</p>
        <h2 id="docs-title" class="display-md">Learn the commands, then forget the docs.</h2>
      </div>
      <div class="docs-grid reveal">
        <table class="command-table">
          <caption class="visually-hidden">Pythinker Code slash commands</caption>
          <tbody>
            <tr><th scope="row"><code>/login</code></th><td>Authenticate with OAuth or API key</td></tr>
            <tr><th scope="row"><code>/mcp-config</code></th><td>Manage MCP servers conversationally</td></tr>
            <tr><th scope="row"><code>/skill:&lt;name&gt;</code></th><td>Invoke an installed skill</td></tr>
            <tr><th scope="row"><code>/help</code></th><td>Keyboard shortcut reference</td></tr>
          </tbody>
        </table>
        <div class="link-rail">
          <a href="https://pymodel.github.io/pythinker-code/guides/getting-started" target="_blank" rel="noopener"><span>Getting Started</span><small>Install, authenticate, and run your first task.</small></a>
          <a href="https://pymodel.github.io/pythinker-code/guides/ides" target="_blank" rel="noopener"><span>Using in IDEs</span><small>Connect Pythinker Code through ACP.</small></a>
          <a href="https://pymodel.github.io/pythinker-code/configuration/config-files" target="_blank" rel="noopener"><span>Configuration</span><small>Set models, providers, and permissions.</small></a>
          <a href="https://pymodel.github.io/pythinker-code/reference/pythinker-command" target="_blank" rel="noopener"><span>Command reference</span><small>Review CLI commands and options.</small></a>
        </div>
      </div>
    </section>

    <section class="section container" aria-labelledby="cta-title">
      <div class="cta-panel reveal">
        <h2 id="cta-title">Install it. Point it at a repo. Ship.</h2>
        <div class="cta-actions">
          <a class="button button-primary" href="#install">Get started</a>
          <a class="button button-secondary" href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener">Read the docs</a>
        </div>
      </div>
    </section>

    <div class="container milestone-footnote">
      <LegacyDownloadsPopup />
    </div>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <div><div class="footer-brand"><PythinkerMascot :width="16" :height="20" /><p class="wordmark">Pythinker Code</p><span class="footer-version">v{{ version }}</span></div><p class="footer-caption">Built by Pymodel. MIT License.</p></div>
      <div class="footer-links">
        <a href="https://github.com/PyModel/pythinker-code" target="_blank" rel="noopener">GitHub</a>
        <a href="https://www.npmjs.com/package/@pymodel/pythinker-code" target="_blank" rel="noopener">npm</a>
        <a href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener">Docs</a>
        <a href="https://pythinker.com" target="_blank" rel="noopener">pythinker.com</a>
        <a href="https://github.com/PyModel/pythinker-code/blob/main/SECURITY.md" target="_blank" rel="noopener">Security</a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-nav {
  position: sticky;
  z-index: 10;
  top: 0;
  height: 64px;
  border-bottom: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
}

.nav-inner {
  display: flex;
  height: 100%;
  align-items: center;
  gap: 24px;
}

.wordmark {
  color: var(--ink);
  font-size: 16px;
  font-weight: 700;
}

.nav-brand,
.footer-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  font-size: 17px;
  font-weight: 700;
}

.nav-actions,
.nav-links {
  display: flex;
  align-items: center;
}

.nav-actions {
  margin-left: auto;
  gap: 20px;
}

.nav-links {
  gap: 28px;
}

.nav-links a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-muted);
  font-size: 15px;
  font-weight: 500;
  transition: color 150ms ease;
}

.nav-links a:hover {
  color: var(--ink);
}

.nav-cta {
  min-height: 44px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 600;
}

.mobile-menu {
  position: relative;
  display: none;
}

.menu-button {
  display: grid;
  width: 44px;
  height: 44px;
  padding: 12px;
  border: 0;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
  place-items: center;
}

.menu-button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.7;
}

.mobile-menu-panel {
  position: absolute;
  z-index: 30;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  padding: 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--canvas);
  box-shadow: var(--shadow-card);
}

.mobile-menu-panel a {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  color: var(--ink);
  font-size: 16px;
  font-weight: 500;
}

.mobile-menu-panel img {
  filter: opacity(0.75);
}

.mobile-menu-panel a:hover {
  background: var(--surface-2);
}

.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.hero {
  position: relative;
  isolation: isolate;
  padding-top: 24px;
}

.hero-copy {
  max-width: 780px;
  margin-inline: auto;
  text-align: center;
}

.hero h1 {
  margin-top: 18px;
  color: var(--ink);
  font-size: clamp(52px, 9vw, 88px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.hero-accent {
  margin-top: 8px;
  color: var(--ink-muted);
  font-size: clamp(24px, 3.4vw, 34px);
  font-style: italic;
  font-weight: 700;
  line-height: 1.2;
}

.hero-lead {
  max-width: 640px;
  margin-top: 24px;
  margin-inline: auto;
  color: var(--ink-muted);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.5;
}

.hero-download {
  margin-top: 24px;
}

.hero-download-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.hero-download-actions .button {
  gap: 8px;
}

.hero-download-actions img {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.hero-download-note {
  margin-top: 10px;
}

.hero-install-label {
  margin-top: 20px;
}

.hero-install {
  max-width: 720px;
  margin: 8px auto 0;
}

.milestone-footnote {
  display: flex;
  margin-block: 48px;
  justify-content: center;
}

.hero-download-note,
.hero-install-label,
.hero-caption {
  color: var(--ink-subtle);
  font-size: 13px;
  line-height: 1.38;
}

.hero-caption {
  margin-top: 12px;
}

.hero-mascot {
  display: block;
  width: clamp(128px, 12vw, 164px);
  height: auto;
  margin-inline: auto;
}

.desktop-showcase {
  display: grid;
  grid-template-columns: 3fr 2fr;
  align-items: center;
  gap: 48px;
}

.desktop-showcase-media {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  aspect-ratio: 2048 / 1300;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--terminal-bg);
  box-shadow: var(--shadow-terminal);
}

.desktop-showcase-media video,
.desktop-showcase-media video > img,
.desktop-showcase-media > img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: 100%;
  object-fit: cover;
}

.desktop-showcase-still {
  display: none !important;
}

.desktop-showcase-copy {
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: flex-start;
}

.desktop-showcase-lead {
  color: var(--ink-muted);
  font-size: 16px;
  line-height: 1.6;
}

.desktop-showcase-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.desktop-showcase-note {
  color: var(--ink-subtle);
  font-size: 13px;
  line-height: 1.5;
}

.works-with {
  display: flex;
  width: 100%;
  margin-top: 80px;
  align-items: center;
  overflow: hidden;
  padding: 0.7rem 0;
  border-top: 1px solid var(--hairline);
  border-bottom: 1px solid var(--hairline);
  background: rgba(17, 17, 19, 0.03);
}

.works-with-label {
  flex-shrink: 0;
  padding: 0 1.75rem;
  border-right: 1px solid var(--hairline);
  color: var(--ink-muted);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  opacity: 0.5;
  text-transform: uppercase;
  white-space: nowrap;
}

.works-with-marquee {
  flex: 1;
  overflow: hidden;
  mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
}

.works-with-track {
  display: inline-flex;
  align-items: center;
  gap: 4rem;
  animation: works-scroll 30s linear infinite;
  white-space: nowrap;
}

.works-with-track:hover {
  animation-play-state: paused;
}

.works-with-logo {
  width: auto;
  height: 28px;
  flex: none;
  filter: grayscale(1) opacity(0.45);
  object-fit: contain;
  transition: filter 200ms ease;
}

.works-with-logo--text {
  height: 22px;
}

.works-with-track:hover .works-with-logo {
  filter: grayscale(0.2) opacity(0.75);
}

@keyframes works-scroll {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(-50%);
  }
}

.section > .display-md {
  max-width: 780px;
}

.command-list,
.plugin-list {
  overflow: hidden;
  margin-top: 32px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas);
}

.command-row {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 18px;
  padding: 12px 16px 12px 24px;
}

.command-row + .command-row,
.plugin-row + .plugin-row {
  border-top: 1px solid var(--hairline-soft);
}

.platform-name {
  display: flex;
  min-width: 200px;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}

.platform-name img,
.terminal-glyph {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.platform-name img {
  filter: opacity(0.75);
}

.terminal-glyph {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.command-row code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 14px;
  white-space: nowrap;
}

.row-copy {
  display: grid;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--ink-subtle);
  cursor: pointer;
}

.row-copy:hover {
  color: var(--ink);
  background: var(--surface-2);
}

.row-copy svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.section-note {
  margin-top: 16px;
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.71;
}

.quickstart-grid,
.docs-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 48px;
  margin-top: 32px;
}

.quickstart-grid {
  align-items: stretch;
}

.terminal-panel {
  position: relative;
  display: flex;
  min-width: 0;
  align-self: stretch;
  margin-top: 16px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(143, 184, 219, 0.24);
  border-radius: 18px;
  background: #0c1e30;
  color: #f1f5fa;
  box-shadow:
    0 28px 60px rgba(16, 38, 59, 0.18),
    0 8px 20px rgba(16, 38, 59, 0.12),
    inset 0 1px rgba(255, 255, 255, 0.08);
}

.terminal-panel::before {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 16%;
  width: 68%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  content: '';
  pointer-events: none;
}

.terminal-header {
  position: relative;
  display: flex;
  height: 50px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(7, 18, 30, 0.58);
  background: linear-gradient(180deg, #294158 0%, #20364d 100%);
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.08),
    inset 0 -1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.terminal-lights {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.terminal-lights span {
  position: relative;
  display: grid;
  width: 12px;
  height: 12px;
  border: 0.5px solid rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  background: #ff5f57;
  box-shadow: inset 0 -1px 1px rgba(0, 0, 0, 0.12);
  place-items: center;
}

.terminal-lights span::after {
  color: rgba(69, 8, 5, 0.62);
  font-family: Arial, sans-serif;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  opacity: 0;
  transition: opacity 100ms ease;
}

.terminal-lights span:first-child::after {
  content: '×';
}

.terminal-lights span:nth-child(2) {
  background: #febc2e;
}

.terminal-lights span:nth-child(2)::after {
  color: rgba(92, 57, 0, 0.7);
  content: '−';
}

.terminal-lights span:nth-child(3) {
  background: #28c840;
}

.terminal-lights span:nth-child(3)::after {
  color: rgba(0, 73, 10, 0.72);
  content: '+';
}

.terminal-lights:hover span::after {
  opacity: 1;
}

.terminal-title {
  position: absolute;
  left: 50%;
  display: flex;
  max-width: calc(100% - 290px);
  align-items: center;
  gap: 7px;
  overflow: hidden;
  color: #bdc9d5;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  font-size: 12px;
  font-weight: 600;
  transform: translateX(-50%);
  white-space: nowrap;
}

.terminal-title > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-title-icon {
  display: grid;
  width: 18px;
  height: 16px;
  flex: 0 0 18px;
  border: 1px solid rgba(183, 205, 225, 0.24);
  border-radius: 4px;
  background: rgba(9, 23, 38, 0.72);
  color: #9db4c9;
  place-items: center;
}

.terminal-title-icon svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}

.terminal-window-actions {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 8px;
}

.terminal-mode {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid rgba(238, 153, 131, 0.24);
  border-radius: var(--r-pill);
  background: rgba(18, 31, 47, 0.32);
  color: #ffc1ad;
  font-size: 11px;
  font-weight: 600;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.04);
}

.terminal-mode span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ee9983;
  box-shadow: 0 0 10px rgba(238, 153, 131, 0.7);
}

.terminal-replay {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  padding: 7px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #8fa4b8;
  cursor: pointer;
  place-items: center;
}

.terminal-replay:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.terminal-replay svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.terminal-body {
  display: flex;
  min-height: 300px;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  padding: 24px;
  background:
    radial-gradient(circle at 50% -25%, rgba(141, 200, 255, 0.06), transparent 48%),
    #0c1e30;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.025);
}

.terminal-session,
.terminal-output {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.terminal-line,
.terminal-output-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10px;
}

.terminal-line code,
.terminal-output-line code {
  min-width: 0;
  color: #aebdca;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.terminal-prompt,
.terminal-output-marker {
  flex: 0 0 12px;
  color: #70879c;
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  text-align: center;
}

.shell-line code {
  color: #c6d0dc;
}

.terminal-flag {
  color: #8dc8ff;
  font-weight: 600;
}

.terminal-yolo-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(238, 153, 131, 0.14);
  border-radius: 8px;
  background: rgba(238, 153, 131, 0.06);
  color: #9fb0bf;
  font-size: 11px;
  line-height: 1.45;
}

.terminal-yolo-note strong {
  color: #ffc1ad;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.terminal-user-line {
  padding: 10px 12px;
  border: 1px solid rgba(141, 200, 255, 0.14);
  border-radius: 8px;
  background: rgba(141, 200, 255, 0.06);
}

.terminal-user-line .terminal-prompt,
.terminal-ready-line .terminal-prompt {
  color: #8dc8ff;
}

.terminal-user-line code {
  color: #f1f5fa;
}

.terminal-output {
  min-height: 72px;
}

.terminal-output-line.is-progress .terminal-output-marker {
  color: #8dc8ff;
}

.terminal-output-line.is-success .terminal-output-marker {
  color: #72dda5;
}

.terminal-output-line.is-success code {
  color: #d9ffeb;
}

.terminal-output-line.is-command .terminal-output-marker {
  color: #ffc1ad;
}

.terminal-ready-line {
  min-height: 20px;
  align-items: center;
}

.terminal-output-enter-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.terminal-output-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  background: #ee9983;
  animation: caret-blink 1.1s steps(1) infinite;
}

.terminal-presets {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(7, 18, 30, 0.58);
  background: linear-gradient(180deg, #22394f 0%, #1f354b 100%);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.045);
}

.terminal-presets-label {
  margin-right: auto;
  color: #70879c;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.terminal-preset {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid rgba(198, 208, 220, 0.13);
  border-radius: var(--r-pill);
  background: transparent;
  color: #aebdca;
  cursor: pointer;
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 11px;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.terminal-preset:hover,
.terminal-preset.is-active {
  border-color: rgba(141, 200, 255, 0.34);
  background: rgba(141, 200, 255, 0.1);
  color: #ffffff;
}

@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

.quickstart-steps {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 28px;
}

.steps {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.steps li {
  counter-increment: step;
}

.steps h3 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.18;
}

.steps h3::before {
  content: counter(step, decimal-leading-zero) ' ';
  color: var(--ink-subtle);
}

.steps p,
.feature-card p {
  margin-top: 8px;
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.71;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 32px;
}

.feature-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas);
  transition: border-color 150ms ease, background-color 150ms ease;
}

.feature-card:hover {
  border-color: var(--surface-3);
  background: var(--canvas);
}

.feature-card.lead {
  grid-column: 1 / -1;
  min-height: 190px;
}

.feature-card h3 {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.18;
}

.feature-card.lead p {
  max-width: 670px;
}

.feature-icons {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 20px;
  opacity: 0.6;
}

.vscode-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  align-items: stretch;
  gap: 48px;
  margin-top: 32px;
}

/* ponytail: the shot fills the card so both columns end on the same line; cover
   crops the screenshot's right-hand marketplace rail, which carries no message */
.vscode-shot {
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--terminal-bg);
  box-shadow: var(--shadow-terminal);
}

.vscode-shot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: left center;
}

.vscode-copy {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.vscode-lead {
  color: var(--ink-muted);
  font-size: 16px;
  line-height: 1.6;
}

.vscode-points {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  list-style: none;
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.6;
}

.vscode-points strong {
  color: var(--ink);
  font-weight: 600;
}

.vscode-points code {
  padding: 1px 5px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 13px;
}

.vscode-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.vscode-actions .button-primary {
  gap: 8px;
}

.vscode-actions .button-primary img {
  filter: brightness(0) invert(1);
}

.vscode-command {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.vscode-command code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  color: var(--ink);
  font-size: 13px;
  white-space: nowrap;
}

.plugin-row {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 24px;
}

.plugin-row p {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.71;
}

.plugin-row strong {
  color: var(--ink);
  font-weight: 600;
}

.plugin-row code {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 14px;
}

.docs-grid {
  grid-template-columns: 2fr 1fr;
}

.command-table {
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  border-spacing: 0;
  background: var(--canvas);
}

.command-table th,
.command-table td {
  padding: 18px 24px;
  text-align: left;
}

.command-table tr + tr th,
.command-table tr + tr td {
  border-top: 1px solid var(--hairline-soft);
}

.command-table th {
  width: 180px;
  font-weight: 500;
}

.command-table code {
  color: var(--ink);
  font-size: 14px;
}

.command-table td {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.71;
}

.link-rail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.link-rail a {
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
}

.link-rail a:hover {
  color: var(--accent);
}

.link-rail small {
  display: block;
  margin-top: 3px;
  color: var(--ink-muted);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.38;
}

.cta-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 48px;
  border-radius: var(--radius);
  background: var(--terminal-bg);
  box-shadow: var(--shadow-terminal);
}

.cta-panel h2 {
  max-width: 620px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.21;
  color: #F1F5FA;
}

.cta-panel .button-primary {
  background: #ffffff;
  color: var(--ink);
}

.cta-panel .button-primary:hover {
  background: var(--surface-1);
}

.cta-panel .button-secondary {
  border-color: rgba(241, 245, 250, 0.3);
  background: transparent;
  color: #F1F5FA;
}

.cta-panel .button-secondary:hover {
  background: rgba(241, 245, 250, 0.08);
}

.cta-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
}

.site-footer {
  margin-top: 96px;
  padding-block: 64px;
  border-top: 1px solid var(--hairline);
  background: var(--canvas);
}

.footer-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
}

.footer-caption {
  margin-top: 6px;
  color: var(--ink-subtle);
  font-size: 13px;
  line-height: 1.38;
}

.footer-version {
  color: var(--ink-subtle);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 12px;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 20px;
}

.footer-links a {
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.38;
}

.footer-links a:hover {
  color: var(--accent);
}

@media (max-width: 899px) {
  .quickstart-grid,
  .docs-grid,
  .vscode-grid,
  .desktop-showcase {
    grid-template-columns: 1fr;
  }

  .cta-panel {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 767px) {
  .nav-inner {
    justify-content: space-between;
  }

  .nav-links {
    display: none;
  }

  .mobile-menu {
    display: block;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }

  .feature-card.lead {
    grid-column: auto;
  }

  .command-row {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
    padding: 16px;
  }

  .platform-name {
    width: calc(100% - 50px);
    min-width: 0;
  }

  .command-row code {
    order: 3;
    flex-basis: 100%;
  }

  .row-copy {
    margin-left: auto;
  }

  .plugin-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .command-table th,
  .command-table td {
    display: block;
    width: 100%;
    padding: 12px 16px;
  }

  .command-table th {
    padding-bottom: 0;
  }

  .command-table td {
    padding-top: 4px;
  }

  .command-table tr + tr th {
    border-top: 1px solid var(--hairline-soft);
  }

  .command-table tr + tr td {
    border-top: 0;
  }

  .footer-inner {
    flex-direction: column;
  }

  .footer-links {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .hero {
    padding-top: 0;
  }

  .hero-lead {
    font-size: 18px;
  }

  .terminal-header {
    padding-inline: 12px;
  }

  .terminal-title {
    display: none;
  }

  .terminal-mode {
    margin-left: auto;
  }

  .terminal-body {
    min-height: 300px;
    padding: 20px 16px;
  }

  .terminal-presets {
    padding-inline: 12px;
  }

  .terminal-presets-label {
    display: none;
  }

  .terminal-preset {
    flex: 1;
  }

  .cta-panel {
    padding: 32px;
  }

  .cta-actions {
    width: 100%;
    flex-direction: column;
  }

  .site-footer {
    margin-top: 48px;
  }
}

@media (max-width: 480px) {
  .nav-inner {
    padding-inline: 12px;
  }

  .nav-brand {
    gap: 6px;
  }

  .nav-actions {
    gap: 8px;
  }

  .nav-cta {
    padding-inline: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-showcase-media video {
    display: none;
  }

  .desktop-showcase-media .desktop-showcase-still {
    display: block !important;
  }

  .works-with-track {
    animation: none;
  }

  .caret {
    animation: none;
  }

  .mobile-menu-enter-active,
  .mobile-menu-leave-active {
    transition: none;
  }
}
</style>
