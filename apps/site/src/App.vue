<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import AgentLoop from './components/AgentLoop.vue';
import HeroBackground from './components/HeroBackground.vue';
import ParticleField from './components/ParticleField.vue';
import PythinkerMascot from './components/PythinkerMascot.vue';

const version = __PYTHINKER_VERSION__;

/**
 * Desktop release currently published on GitHub. This tracks the published
 * release, not apps/desktop/package.json: the manifest is bumped by changesets
 * ahead of the build that produces these assets. Bump this only after the
 * matching desktop release is public.
 */
const DESKTOP_VERSION = '0.1.0';
const DESKTOP_RELEASE_BASE = `https://github.com/PyModel/pythinker-code/releases/download/v${DESKTOP_VERSION}`;
const desktopDownloads = {
  mac: `${DESKTOP_RELEASE_BASE}/Pythinker-${DESKTOP_VERSION}-arm64.dmg`,
  windows: `${DESKTOP_RELEASE_BASE}/Pythinker-${DESKTOP_VERSION}-x64-Setup.exe`,
};

const installRows = [
  ['macOS / Linux', 'curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash', '/brand/apple.svg'],
  ['Windows (PowerShell)', 'irm https://code.pythinker.com/pythinker-code/install.ps1 | iex', '/brand/windows11.svg'],
  ['Homebrew', 'brew install pymodel/tap/pythinker-code'],
  ['Nix', 'nix run github:PyModel/pythinker-code'],
  ['npm', 'npm install -g @pymodel/pythinker-code', '/brand/npm.svg'],
  ['Verify', 'pythinker --version'],
];

const features = [
  {
    id: 'subagents',
    title: 'Parallel Subagent Swarms',
    body: 'Dispatch coder, explore, and planning agents in isolated branches from a single supervisory loop. The agent synchronizes results and iterates until all verification passes.',
    badge: 'Autonomous',
  },
  {
    id: 'acp',
    title: 'ACP Editor Integration',
    body: 'Run pythinker acp to connect any Agent Client Protocol compatible editor, including Zed, Cursor, and JetBrains, for inline sessions.',
    badge: 'Protocol Native',
  },
  {
    id: 'mcp',
    title: 'Universal MCP Ecosystem',
    body: 'Connect external Model Context Protocol tools and servers dynamically via /mcp-config for seamless context expansion.',
    badge: 'Extensible',
  },
  {
    id: 'skills',
    title: 'Custom Skills & Hooks',
    body: 'Define repo-local instructions with /skill and wire lifecycle security hooks to inspect and gate destructive tool calls.',
    badge: 'Customizable',
  },
  {
    id: 'byom',
    title: 'Model & Provider Agnostic',
    body: 'Works seamlessly with Pythinker managed models, Anthropic Claude, OpenAI, DeepSeek, Google Gemini, Ollama, and custom endpoints.',
    badge: 'Zero Lock-in',
  },
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
  }, 1800);
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

  const delay = visibleTerminalLines.value === 0 ? 380 : 640;
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
  }, { threshold: 0.12 });

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
      <a href="/" class="nav-brand">
        <PythinkerMascot :width="26" :height="32" />
        <span class="brand-text">Pythinker Code</span>
      </a>
      
      <div class="nav-actions">
        <div class="nav-links">
          <a href="#desktop">Desktop</a>
          <a href="#install">CLI</a>
          <a href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener">Docs</a>
        </div>
        
        <a class="button button-primary nav-cta" href="#install">Get started</a>
        
        <div ref="mobileMenu" class="mobile-menu" @mouseenter="openMenuOnHover" @mouseleave="closeMenuOnHover">
          <button ref="menuButton" class="menu-button" type="button" aria-label="Menu" aria-haspopup="true" :aria-expanded="menuOpen" @click="toggleMenu">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Transition name="mobile-menu">
            <div v-show="menuOpen" class="mobile-menu-panel">
              <a href="#desktop" @click="closeMenu(false)">Desktop</a>
              <a href="#install" @click="closeMenu(false)">CLI</a>
              <a href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener" @click="closeMenu(false)">Docs</a>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </nav>

  <!-- Atmospheric Dark Hero Wrapper -->
  <div class="hero-atmosphere-wrapper">
    <HeroBackground />

    <!-- Top Hero Section -->
    <header id="desktop" class="hero container">
      <div class="hero-main-grid">
        <div class="hero-copy">
          <div class="hero-greeting" aria-hidden="true">
            <img src="/mascot-waving.png" alt="" width="72" height="78" />
            <span>Hello</span>
          </div>
          <h1 class="hero-title">
            <span>Pythinker</span>
            <span>Code</span>
            <span>Desktop</span>
          </h1>
          
          <p class="hero-lead">A ready-to-use desktop app built on the official Pythinker Code agent. It reads your repo, edits files, runs commands, and iterates until the job is done.</p>
          
          <div class="hero-download-buttons">
            <a class="button button-download-mac" :href="desktopDownloads.mac" rel="noopener">
              <img src="/brand/apple.svg" alt="" aria-hidden="true" class="button-os-icon" />
              <span>Download for Mac</span>
            </a>
            <a class="button button-download-win" :href="desktopDownloads.windows" rel="noopener">
              <img
                src="/mascot-jumping.png"
                alt=""
                width="72"
                height="78"
                class="hero-download-jumper"
              />
              <img src="/brand/windows11.svg" alt="" aria-hidden="true" class="button-os-icon" />
              <span>Download for Windows</span>
            </a>
          </div>
          
          <div class="hero-subactions">
            <a class="button button-github-pill" href="https://github.com/PyModel/pythinker-code" target="_blank" rel="noopener">
              <img src="/brand/github.svg" alt="" width="16" height="16" />
              <span>View on GitHub</span>
            </a>
            <span class="hero-badge-oss">Open source, MIT licensed</span>
          </div>
        </div>
        
        <div class="hero-preview">
          <div class="hero-preview-mascot-lane" aria-hidden="true">
            <img
              src="/mascot-running-left.png"
              alt=""
              width="72"
              height="78"
              class="hero-mascot-runner hero-mascot-runner--left"
            />
          </div>
          <img
            src="/pythinker_desktop.webp"
            alt="Pythinker Desktop application workspace"
            width="2428"
            height="1654"
            loading="eager"
            class="hero-app-shot"
          />
        </div>
      </div>

      <!-- Floating Hero Providers Marquee -->
      <div class="hero-providers-bar" aria-label="Compatible with leading AI models and providers">
        <div class="hero-mascot-lane" aria-hidden="true">
          <img
            src="/mascot-running-right.png"
            alt=""
            width="72"
            height="78"
            class="hero-mascot-runner hero-mascot-runner--right"
          />
        </div>
        <div class="hero-providers-label">Supported Providers</div>
        <div class="hero-providers-marquee" aria-hidden="true">
          <div class="hero-providers-track">
            <img src="/brand/anthropic.svg" alt="Anthropic" class="hero-provider-logo" />
            <img src="/brand/openai.svg" alt="OpenAI" class="hero-provider-logo" />
            <img src="/brand/gemini.svg" alt="Google Gemini" class="hero-provider-logo" />
            <img src="/brand/ollama.svg" alt="Ollama" class="hero-provider-logo" />
            <img src="/brand/lmstudio.svg" alt="LM Studio" class="hero-provider-logo" />
            <img src="/brand/deepseek.svg" alt="DeepSeek" class="hero-provider-logo" />
            <img src="/brand/meta.svg" alt="Meta / Llama" class="hero-provider-logo" />
            <img src="/brand/mistral.svg" alt="Mistral" class="hero-provider-logo" />
            <img src="/brand/groq.svg" alt="Groq" class="hero-provider-logo hero-provider-logo--text" />
            <img src="/brand/aws.svg" alt="AWS" class="hero-provider-logo hero-provider-logo--text" />
            <img src="/brand/anthropic.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/openai.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/gemini.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/ollama.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/lmstudio.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/deepseek.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/meta.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/mistral.svg" alt="" class="hero-provider-logo" />
            <img src="/brand/groq.svg" alt="" class="hero-provider-logo hero-provider-logo--text" />
            <img src="/brand/aws.svg" alt="" class="hero-provider-logo hero-provider-logo--text" />
          </div>
        </div>
      </div>
    </header>
  </div>

  <main id="main-content">
    <!-- VS Code Extension Showcase -->
    <section id="vscode" class="section container" aria-labelledby="vscode-title">
      <div class="reveal section-header">
        <p class="eyebrow">Editor Integration</p>
        <h2 id="vscode-title" class="display-md">The same autonomous engine, inside your editor.</h2>
      </div>
      
      <div class="vscode-grid">
        <figure class="vscode-shot reveal">
          <div class="vscode-window-titlebar">
            <span class="window-dot red"></span>
            <span class="window-dot yellow"></span>
            <span class="window-dot green"></span>
            <span class="vscode-titlebar-text">Visual Studio Code</span>
          </div>
          <img
            src="/vscode_img.jpeg"
            alt="Pythinker Code running in the VS Code sidebar next to active editor tabs"
            width="1280"
            height="844"
            loading="lazy"
            decoding="async"
          />
        </figure>
        
        <div class="vscode-copy reveal">
          <p class="vscode-lead">Install from the VS Code Marketplace to access Pythinker Code in your sidebar. It inspects your repo, proposes edits in the native diff viewer, and runs terminal commands with granular approval.</p>
          
          <div class="vscode-features-list">
            <div class="vscode-feature-item">
              <div class="feature-bullet-icon">
                <svg viewBox="0 0 16 16"><path d="M2 4h12M2 8h12M2 12h8" /></svg>
              </div>
              <div>
                <strong>Native diff inspection</strong>
                <p>Review every file modification in VS Code's side-by-side diff viewer before applying changes.</p>
              </div>
            </div>
            
            <div class="vscode-feature-item">
              <div class="feature-bullet-icon">
                <svg viewBox="0 0 16 16"><path d="M4 4h8v8H4zM2 8h2M12 8h2" /></svg>
              </div>
              <div>
                <strong>Unified configuration</strong>
                <p>Shares the exact same <code>config.toml</code>, MCP server pool, and session state with the CLI.</p>
              </div>
            </div>
            
            <div class="vscode-feature-item">
              <div class="feature-bullet-icon">
                <svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" /></svg>
              </div>
              <div>
                <strong>Adaptive thinking controls</strong>
                <p>Toggle reasoning depth and thinking budgets on a per-task basis.</p>
              </div>
            </div>
          </div>
          
          <div class="vscode-actions">
            <a class="button button-primary" href="https://marketplace.visualstudio.com/items?itemName=pymodel.pythinker" target="_blank" rel="noopener">
              <img src="/brand/visualstudiocode.svg" alt="" width="16" height="16" />
              <span>Get the extension</span>
            </a>
            
            <div class="vscode-command">
              <code>code --install-extension pymodel.pythinker</code>
              <button class="row-copy" type="button" aria-label="Copy VS Code install command" @click="copyText(vscodeInstallCommand)">
                <svg v-if="copiedCommand === vscodeInstallCommand" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
                <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
              </button>
            </div>
          </div>
          
          <p class="section-note">Requires VS Code 1.100.0 or later. Fully compatible with Cursor, Windsurf, and other VS Code forks.</p>
        </div>
      </div>
    </section>

    <!-- Quickstart & Interactive Terminal Demo -->
    <section id="quickstart" class="section container" aria-labelledby="quickstart-title">
      <div class="reveal section-header">
        <p class="eyebrow">Quick Start</p>
        <h2 id="quickstart-title" class="display-md">From installation to first task in seconds.</h2>
      </div>
      
      <div class="quickstart-grid">
        <!-- Interactive Terminal Panel -->
        <div class="terminal-panel" aria-label="Interactive macOS-style Pythinker Code terminal demo">
          <div class="terminal-header">
            <div class="terminal-lights" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="terminal-title" aria-hidden="true">
              <span class="terminal-title-icon"><svg viewBox="0 0 16 16"><path d="m3 5 2.5 2.5L3 10M7 10h5" /></svg></span>
              <span>your-project: zsh</span>
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
            
            <div class="terminal-yolo-note">
              <strong>YOLO</strong>
              <span>Autonomous execution mode: tool actions execute with safe iteration bounds.</span>
            </div>
            
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
            <span class="terminal-presets-label">Presets</span>
            <div class="terminal-presets-buttons">
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
        </div>

        <!-- Side Loop Diagram & Step Guide -->
        <div class="quickstart-steps">
          <div class="agent-loop-wrapper">
            <AgentLoop />
          </div>
          
          <ol class="steps-card-list">
            <li class="step-card">
              <div class="step-index">01</div>
              <div class="step-content">
                <h3>Authenticate</h3>
                <p>Run <code>/login</code> to connect with Pythinker Code OAuth or provide an API key.</p>
              </div>
            </li>
            <li class="step-card">
              <div class="step-index">02</div>
              <div class="step-content">
                <h3>Assign a task</h3>
                <p>Describe your goal: refactor modules, fix failing tests, or scaffold new microservices.</p>
              </div>
            </li>
            <li class="step-card">
              <div class="step-index">03</div>
              <div class="step-content">
                <h3>Review & Ship</h3>
                <p>Inspect tool diffs in real time with granular permission gates and safety rollbacks.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- Capabilities Bento Grid -->
    <section id="features" class="section container" aria-labelledby="features-title">
      <div class="reveal section-header">
        <p class="eyebrow">Capabilities</p>
        <h2 id="features-title" class="display-md">Engineered for autonomous software delivery.</h2>
      </div>
      
      <div class="bento-grid">
        <!-- Lead Bento Card: Parallel Subagent Swarms -->
        <article class="bento-card bento-card-lead reveal">
          <div class="bento-card-header">
            <span class="bento-badge">Multi-Agent Swarms</span>
            <h3>Parallel Subagent Execution</h3>
            <p>Dispatch specialized subagents (coder, explore, plan) across isolated Git worktrees. The supervisory agent coordinates tasks and consolidates the solution without context clutter.</p>
          </div>
          
          <div class="subagents-visual" aria-hidden="true">
            <div class="subagent-node supervisor-node">
              <span class="node-badge">Supervisor</span>
              <span class="node-title">pythinker-coordinator</span>
            </div>
            <div class="subagent-branch-lines">
              <span class="branch-line"></span>
              <span class="branch-line"></span>
              <span class="branch-line"></span>
            </div>
            <div class="subagent-children">
              <div class="subagent-child">
                <div class="child-heading">
                  <span class="child-indicator is-running"></span>
                  <span class="child-name">explore-agent</span>
                </div>
                <span class="child-task">repo indexing</span>
              </div>
              <div class="subagent-child">
                <div class="child-heading">
                  <span class="child-indicator is-running"></span>
                  <span class="child-name">coder-agent</span>
                </div>
                <span class="child-task">patching logic</span>
              </div>
              <div class="subagent-child">
                <div class="child-heading">
                  <span class="child-indicator is-done"></span>
                  <span class="child-name">test-verifier</span>
                </div>
                <span class="child-task">all tests passed</span>
              </div>
            </div>
          </div>
        </article>

        <!-- Bento Card 2: ACP Editor Protocol -->
        <article class="bento-card reveal" style="transition-delay: 80ms">
          <div class="bento-card-header">
            <span class="bento-badge">Protocol Native</span>
            <h3>ACP Editor Integration</h3>
            <p>Run <code>pythinker acp</code> for native editor integration across Zed, Cursor, and JetBrains.</p>
          </div>
          <div class="bento-icon-tray" aria-hidden="true">
            <img src="/brand/visualstudiocode.svg" alt="" width="20" height="20" />
            <img src="/brand/jetbrains.svg" alt="" width="20" height="20" />
          </div>
        </article>

        <!-- Bento Card 3: Universal MCP Tools -->
        <article class="bento-card reveal" style="transition-delay: 160ms">
          <div class="bento-card-header">
            <span class="bento-badge">Extensible</span>
            <h3>Model Context Protocol</h3>
            <p>Load any MCP server dynamically with <code>/mcp-config</code>. Database, browser, and search tools work instantly.</p>
          </div>
          <div class="bento-code-pill" aria-hidden="true">
            <code>/mcp-config add postgres</code>
          </div>
        </article>

        <!-- Bento Card 4: Custom Skills & Hooks -->
        <article class="bento-card reveal" style="transition-delay: 240ms">
          <div class="bento-card-header">
            <span class="bento-badge">Customizable</span>
            <h3>Skills & Lifecycle Hooks</h3>
            <p>Add repo-local custom skills via <code>/skill</code> and configure pre-execution hooks to prevent accidental destructive calls.</p>
          </div>
          <div class="bento-code-pill" aria-hidden="true">
            <code>.agents/skills/deploy.md</code>
          </div>
        </article>

        <!-- Bento Card 5: Provider Agnostic -->
        <article class="bento-card reveal" style="transition-delay: 320ms">
          <div class="bento-card-header">
            <span class="bento-badge">Zero Lock-In</span>
            <h3>Universal LLM Compatibility</h3>
            <p>Switch between Claude 3.7 Sonnet, OpenAI o3, DeepSeek, Google Gemini, or local models running via Ollama.</p>
          </div>
          <div class="bento-provider-chips" aria-hidden="true">
            <span class="provider-chip">Claude 3.7</span>
            <span class="provider-chip">GPT-4.5</span>
            <span class="provider-chip">DeepSeek R1</span>
            <span class="provider-chip">Ollama</span>
          </div>
        </article>
      </div>
    </section>

    <!-- Installation Matrix -->
    <section id="install" class="section container" aria-labelledby="install-title">
      <div class="reveal section-header">
        <p class="eyebrow">Installation</p>
        <h2 id="install-title" class="display-md">Every platform, one command.</h2>
      </div>
      
      <div class="command-list reveal">
        <div v-for="([platform, command, icon]) in installRows" :key="platform" class="command-row">
          <span class="platform-name">
            <span class="platform-icon-wrapper">
              <img v-if="icon" :src="icon" alt="" width="16" height="16" class="platform-brand-icon" />
              <svg v-else class="terminal-glyph" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 5.5l3 2.5-3 2.5M8.5 10.5h3.5" /></svg>
            </span>
            <span class="platform-title">{{ platform }}</span>
          </span>
          <code class="command-code">{{ command }}</code>
          <button class="row-copy" type="button" :aria-label="`Copy ${platform} command`" @click="copyText(command)">
            <svg v-if="copiedCommand === command" class="check-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
            <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
            <span class="row-copy-tooltip">{{ copiedCommand === command ? 'Copied!' : 'Copy' }}</span>
          </button>
        </div>
      </div>
      
      <p class="section-note">Windows requires Git for Windows with bundled Git Bash. All binary releases include SHA-256 integrity checksums.</p>
      <span class="visually-hidden" aria-live="polite">{{ copiedCommand ? 'Copied to clipboard' : '' }}</span>
    </section>

    <!-- Plugin Marketplace -->
    <section class="section container" aria-labelledby="plugins-title">
      <div class="reveal section-header">
        <p class="eyebrow">Plugin Ecosystem</p>
        <h2 id="plugins-title" class="display-md">Extend workflows from the curated registry.</h2>
      </div>
      
      <div class="plugin-grid">
        <div class="plugin-card reveal">
          <div class="plugin-badge-row">
            <span class="plugin-tag official">Official</span>
            <span class="plugin-version">v3.2.0</span>
          </div>
          <h3>pythinker-datasource</h3>
          <p>Financial, macroeconomic, academic research, and enterprise knowledge graph search tools for coding agents.</p>
          <div class="plugin-install-box">
            <code>/plugins install datasource</code>
            <button class="row-copy" type="button" aria-label="Copy datasource install command" @click="copyText('/plugins install datasource')">
              <svg v-if="copiedCommand === '/plugins install datasource'" class="check-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
            </button>
          </div>
        </div>

        <div class="plugin-card reveal" style="transition-delay: 100ms">
          <div class="plugin-badge-row">
            <span class="plugin-tag curated">Curated</span>
            <span class="plugin-version">v6.2.0</span>
          </div>
          <h3>superpowers</h3>
          <p>Structured test-driven development (TDD), automated refactoring plans, and proactive debugging suites.</p>
          <div class="plugin-install-box">
            <code>/plugins install superpowers</code>
            <button class="row-copy" type="button" aria-label="Copy superpowers install command" @click="copyText('/plugins install superpowers')">
              <svg v-if="copiedCommand === '/plugins install superpowers'" class="check-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 20 20"><rect x="7" y="3" width="10" height="11" rx="2" /><rect x="3" y="7" width="10" height="10" rx="2" /></svg>
            </button>
          </div>
        </div>
      </div>
      
      <p class="section-note">Plugins are distributed over HTTPS and managed directly within the Pythinker CLI.</p>
    </section>

    <!-- Command Reference & Documentation -->
    <section id="docs" class="section container" aria-labelledby="docs-title">
      <div class="reveal section-header">
        <p class="eyebrow">Developer Reference</p>
        <h2 id="docs-title" class="display-md">Quick commands and guides.</h2>
      </div>
      
      <div class="docs-grid reveal">
        <div class="command-table-wrapper">
          <table class="command-table">
            <caption class="visually-hidden">Pythinker Code slash commands cheat sheet</caption>
            <thead>
              <tr>
                <th scope="col">Command</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row"><code>/login</code></th><td>Authenticate with OAuth or provider API keys</td></tr>
              <tr><th scope="row"><code>/mcp-config</code></th><td>Configure MCP servers conversationally</td></tr>
              <tr><th scope="row"><code>/skill:&lt;name&gt;</code></th><td>Invoke an installed custom skill</td></tr>
              <tr><th scope="row"><code>/model</code></th><td>Switch the active model or provider backend</td></tr>
              <tr><th scope="row"><code>/tasks</code></th><td>Inspect background subagent workflows</td></tr>
              <tr><th scope="row"><code>/help</code></th><td>Display keyboard shortcuts and system commands</td></tr>
            </tbody>
          </table>
        </div>
        
        <div class="link-rail">
          <a href="https://pymodel.github.io/pythinker-code/guides/getting-started" target="_blank" rel="noopener" class="doc-card-link">
            <div class="doc-card-header">
              <span class="doc-card-title">Getting Started</span>
              <svg class="arrow-icon" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
            </div>
            <small>Install, authenticate, and run your first repository task.</small>
          </a>
          <a href="https://pymodel.github.io/pythinker-code/guides/ides" target="_blank" rel="noopener" class="doc-card-link">
            <div class="doc-card-header">
              <span class="doc-card-title">Editor Protocols</span>
              <svg class="arrow-icon" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
            </div>
            <small>Connect Pythinker Code through ACP to Zed and VS Code.</small>
          </a>
          <a href="https://pymodel.github.io/pythinker-code/configuration/config-files" target="_blank" rel="noopener" class="doc-card-link">
            <div class="doc-card-header">
              <span class="doc-card-title">Configuration</span>
              <svg class="arrow-icon" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
            </div>
            <small>Customize provider models, permissions, and tools.</small>
          </a>
          <a href="https://pymodel.github.io/pythinker-code/reference/pythinker-command" target="_blank" rel="noopener" class="doc-card-link">
            <div class="doc-card-header">
              <span class="doc-card-title">CLI Reference</span>
              <svg class="arrow-icon" viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" /></svg>
            </div>
            <small>Comprehensive flags, subcommands, and environment variables.</small>
          </a>
        </div>
      </div>
    </section>

    <!-- Call to Action Banner -->
    <section class="section container" aria-labelledby="cta-title">
      <div class="cta-panel reveal">
        <div class="cta-content">
          <span class="cta-badge">Ready to accelerate delivery?</span>
          <h2 id="cta-title">Install it. Point it at a repo. Ship.</h2>
          <p class="cta-desc">Join thousands of developers shipping faster with autonomous AI engineering.</p>
        </div>
        <div class="cta-actions">
          <a class="button button-accent cta-primary-btn" href="#install">Get started free</a>
          <a class="button button-secondary cta-secondary-btn" href="https://pymodel.github.io/pythinker-code/" target="_blank" rel="noopener">Read the docs</a>
        </div>
      </div>
    </section>

  </main>

  <!-- Site Footer -->
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-left">
        <div class="footer-brand">
          <PythinkerMascot :width="20" :height="24" />
          <span class="footer-wordmark">Pythinker Code</span>
          <span class="footer-version">v{{ version }}</span>
        </div>
        <p class="footer-caption">Built with precision by Pymodel. Released under the MIT License.</p>
      </div>
      
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
/* ==========================================================================
   Atmospheric Dark Hero Container
   ========================================================================== */
.hero-atmosphere-wrapper {
  position: relative;
  width: 100%;
  background: linear-gradient(180deg, #060b14 0%, #08111f 55%, #0b172a 100%);
  color: #ffffff;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

/* ==========================================================================
   Navigation Bar
   ========================================================================== */
.site-nav {
  position: sticky;
  z-index: 100;
  top: 0;
  height: 64px;
  border-bottom: 1px solid var(--hairline);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: background-color 150ms ease, border-color 150ms ease;
}

.nav-inner {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  font-size: 16.5px;
  font-weight: 700;
  letter-spacing: -0.025em;
  transition: opacity 140ms ease;
}

.nav-brand:hover {
  opacity: 0.85;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 28px;
}

.nav-links a {
  display: inline-flex;
  align-items: center;
  color: var(--ink-muted);
  font-size: 14.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
  transition: color 140ms ease;
}

.nav-links a:hover {
  color: var(--ink);
}

.nav-cta {
  min-height: 38px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.mobile-menu {
  position: relative;
  display: none;
}

.menu-button {
  display: grid;
  width: 40px;
  height: 40px;
  padding: 10px;
  border: 0;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
  place-items: center;
}

.menu-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.mobile-menu-panel {
  position: absolute;
  z-index: 50;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  padding: 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--canvas);
  box-shadow: var(--shadow-md);
}

.mobile-menu-panel a {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-size: 15px;
  font-weight: 500;
  transition: background-color 100ms ease;
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
  transform: translateY(-6px);
}

/* ==========================================================================
   Hero Section
   ========================================================================== */
.hero {
  position: relative;
  z-index: 1;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 64px);
  padding-top: 48px;
  padding-bottom: 28px;
  gap: 32px;
}

.hero-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 420px) 1fr;
  align-items: center;
  gap: 48px;
  width: 100%;
  margin-block: auto;
}

.hero-copy {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.hero-greeting {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  display: flex;
  align-items: flex-start;
  pointer-events: none;
  animation: mascot-greeting-cycle 120s ease infinite;
}

.hero-greeting img {
  display: block;
  width: 72px;
  height: 78px;
  object-fit: contain;
  filter: drop-shadow(0 8px 8px rgba(0, 0, 0, 0.24));
}

.hero-greeting span {
  margin-top: 4px;
  margin-left: -4px;
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.94);
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
}

.hero-title {
  display: flex;
  flex-direction: column;
  color: #ffffff;
  font-size: clamp(40px, 4.2vw, 56px);
  font-weight: 750;
  line-height: 1.04;
  letter-spacing: -0.04em;
  margin: 0;
}

.hero-lead {
  max-width: 420px;
  margin-top: 20px;
  color: #94a3b8;
  font-size: 15.5px;
  font-weight: 400;
  line-height: 1.6;
  letter-spacing: -0.008em;
}

.hero-download-buttons {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  flex-wrap: wrap;
  width: max-content;
}

.button-download-mac,
.button-download-win {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 46px;
  padding: 10px 22px;
  border-radius: var(--radius-pill);
  background: #ffffff;
  color: #09090b;
  border: 1px solid #ffffff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: all 140ms cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}

.button-download-mac:hover,
.button-download-win:hover {
  background: #f1f5f9;
  border-color: #f1f5f9;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.button-os-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.hero-subactions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
}

.button-github-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 18px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  font-size: 13.5px;
  font-weight: 600;
  transition: all 140ms ease;
}

.button-github-pill:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.24);
  color: #ffffff;
  transform: translateY(-1px);
}

.button-github-pill img {
  filter: brightness(0) invert(1);
  opacity: 0.85;
}

.hero-badge-oss {
  color: #64748b;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

/* ==========================================================================
   Hero Desktop App Image (Right Column)
   ========================================================================== */
.hero-preview {
  position: relative;
  display: flex;
  width: calc(100% + clamp(236px, 22vw, 340px));
  align-items: center;
  justify-content: flex-end;
  margin-right: clamp(-340px, -22vw, -236px);
}

.hero-preview-mascot-lane {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: calc(100% - 8px);
  left: 0;
  height: 78px;
  overflow: hidden;
  pointer-events: none;
}

.hero-download-jumper {
  position: absolute;
  z-index: 1;
  bottom: calc(100% - 6px);
  left: 50%;
  display: block;
  width: 72px;
  height: 78px;
  object-fit: contain;
  opacity: 0;
  pointer-events: none;
  filter: drop-shadow(0 8px 8px rgba(0, 0, 0, 0.24));
  transform: translateX(-50%);
  animation: mascot-jump-cycle 120s ease 28s infinite;
}

.hero-app-shot {
  position: relative;
  z-index: 0;
  display: block;
  width: 100%;
  max-width: none;
  height: auto;
  border-radius: 14px;
  box-shadow: 0 24px 52px -32px rgba(15, 23, 42, 0.32);
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.hero-preview::after {
  position: absolute;
  z-index: 1;
  inset: 0;
  border-radius: 14px;
  background: rgba(71, 85, 105, 0.1);
  content: '';
  pointer-events: none;
}

.hero-app-shot:hover {
  transform: translateY(-3px);
  box-shadow: 0 30px 60px -32px rgba(15, 23, 42, 0.38);
}

/* ==========================================================================
   Floating Hero Providers Marquee Bar
   ========================================================================== */
.hero-providers-bar {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  margin-top: auto;
  padding: 10px 20px;
  border-radius: var(--radius-pill);
  background: rgba(10, 18, 32, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 
    0 8px 32px -4px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.hero-mascot-lane {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: calc(100% - 8px);
  left: 0;
  height: 78px;
  overflow: hidden;
  pointer-events: none;
}

.hero-mascot-runner {
  position: absolute;
  bottom: 0;
  left: -72px;
  display: block;
  width: 72px;
  height: 78px;
  object-fit: contain;
  filter: drop-shadow(0 8px 8px rgba(0, 0, 0, 0.24));
  animation: mascot-run-cycle 120s linear infinite backwards;
}

.hero-mascot-runner--right {
  animation-delay: 4s;
}


.hero-mascot-runner--left {
  animation-name: mascot-run-cycle-left;
  animation-delay: 16s;
}

@keyframes mascot-run-cycle {
  0% {
    left: -72px;
    opacity: 1;
  }

  10% {
    left: 100%;
    opacity: 1;
  }

  10.01% {
    left: 100%;
    opacity: 0;
  }

  99.99% {
    left: -72px;
    opacity: 0;
  }

  100% {
    left: -72px;
    opacity: 1;
  }
}

@keyframes mascot-run-cycle-left {
  0% {
    left: 100%;
    opacity: 1;
  }

  10% {
    left: -72px;
    opacity: 1;
  }

  10.01% {
    left: -72px;
    opacity: 0;
  }

  99.99% {
    left: 100%;
    opacity: 0;
  }

  100% {
    left: 100%;
    opacity: 1;
  }
}

@keyframes mascot-greeting-cycle {
  0%,
  3.33% {
    opacity: 1;
    transform: translateY(0);
  }

  4%,
  99.99% {
    opacity: 0;
    transform: translateY(6px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes mascot-jump-cycle {
  0%,
  3.33% {
    opacity: 1;
  }

  3.34%,
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-greeting,
  .hero-mascot-runner,
  .hero-download-jumper {
    display: none;
  }
}

.hero-providers-label {
  flex-shrink: 0;
  padding-right: 18px;
  margin-right: 18px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  font-family: 'Geist Mono', monospace;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.hero-providers-marquee {
  flex: 1;
  overflow: hidden;
  mask-image: linear-gradient(to right, transparent, black 4%, black 96%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 4%, black 96%, transparent);
}

.hero-providers-track {
  display: inline-flex;
  align-items: center;
  gap: 3.5rem;
  animation: works-scroll 32s linear infinite;
  white-space: nowrap;
}

.hero-providers-track:hover {
  animation-play-state: paused;
}

.hero-provider-logo {
  width: auto;
  height: 22px;
  flex: none;
  filter: brightness(0) invert(1) opacity(0.48);
  object-fit: contain;
  transition: opacity 160ms ease, filter 160ms ease;
}

.hero-provider-logo--text {
  height: 17px;
}

.hero-providers-track:hover .hero-provider-logo {
  opacity: 0.9;
  filter: brightness(0) invert(1) opacity(0.9);
}

@keyframes works-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* ==========================================================================
   VS Code Section
   ========================================================================== */
.vscode-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  align-items: stretch;
  gap: 48px;
}

.vscode-shot {
  overflow: hidden;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: #1e1e1e;
  box-shadow: var(--shadow-terminal);
}

.vscode-window-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #252526;
  border-bottom: 1px solid #333333;
}

.vscode-titlebar-text {
  color: #cccccc;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 11px;
  margin-left: 8px;
}

.vscode-shot img {
  display: block;
  width: 100%;
  height: calc(100% - 34px);
  object-fit: cover;
  object-position: left top;
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

.vscode-features-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vscode-feature-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.feature-bullet-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 8px;
  background: var(--accent-subtle);
  color: var(--accent);
  place-items: center;
  margin-top: 2px;
}

.feature-bullet-icon svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.vscode-feature-item strong {
  display: block;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 2px;
}

.vscode-feature-item p {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.5;
}

.vscode-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  margin-top: 8px;
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
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.vscode-command code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
  white-space: nowrap;
}

.section-note {
  margin-top: 14px;
  color: var(--ink-subtle);
  font-size: 13px;
  line-height: 1.6;
}

/* ==========================================================================
   Terminal & Quickstart Section
   ========================================================================== */
.quickstart-grid {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 40px;
  align-items: stretch;
}

.terminal-panel {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--terminal-border);
  border-radius: var(--radius-lg);
  background: var(--terminal-bg);
  color: var(--terminal-text);
  box-shadow: var(--shadow-terminal);
}

.terminal-header {
  position: relative;
  display: flex;
  height: 48px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, #152238 0%, #0d1624 100%);
  user-select: none;
}

.terminal-lights {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.terminal-lights span {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #ff5f57;
}

.terminal-lights span:nth-child(2) { background: #febc2e; }
.terminal-lights span:nth-child(3) { background: #28c840; }

.terminal-title {
  position: absolute;
  left: 50%;
  display: flex;
  max-width: calc(100% - 280px);
  align-items: center;
  gap: 8px;
  overflow: hidden;
  color: #94a3b8;
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  transform: translateX(-50%);
  white-space: nowrap;
}

.terminal-title-icon {
  display: grid;
  width: 18px;
  height: 16px;
  flex: 0 0 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  place-items: center;
}

.terminal-title-icon svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}

.terminal-window-actions {
  display: flex;
  margin-left: auto;
  align-items: center;
  gap: 10px;
}

.terminal-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid var(--coral-subtle);
  border-radius: var(--radius-pill);
  background: rgba(238, 153, 131, 0.08);
  color: #ffc1ad;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
}

.terminal-mode span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--coral-accent);
  box-shadow: 0 0 8px var(--coral-accent);
}

.terminal-replay {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 6px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  place-items: center;
  transition: all 120ms ease;
}

.terminal-replay:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.terminal-replay svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.6;
}

.terminal-body {
  display: flex;
  min-height: 290px;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 22px;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(37, 99, 235, 0.07) 0%, transparent 60%),
    var(--terminal-bg);
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
  color: #cbd5e1;
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.terminal-prompt,
.terminal-output-marker {
  flex: 0 0 12px;
  color: #64748b;
  font-family: 'Geist Mono', monospace;
  text-align: center;
}

.shell-line code {
  color: #e2e8f0;
}

.terminal-flag {
  color: #60a5fa;
  font-weight: 600;
}

.terminal-yolo-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(238, 153, 131, 0.18);
  border-radius: 6px;
  background: rgba(238, 153, 131, 0.06);
  color: #cbd5e1;
  font-size: 12px;
}

.terminal-yolo-note strong {
  color: #ffc1ad;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.terminal-user-line {
  padding: 8px 12px;
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 8px;
  background: rgba(37, 99, 235, 0.08);
}

.terminal-user-line .terminal-prompt {
  color: #60a5fa;
}

.terminal-user-line code {
  color: #ffffff;
  font-weight: 500;
}

.terminal-output {
  min-height: 68px;
}

.terminal-output-line.is-progress .terminal-output-marker {
  color: #60a5fa;
}

.terminal-output-line.is-success .terminal-output-marker {
  color: #34d399;
}

.terminal-output-line.is-success code {
  color: #d1fae5;
}

.terminal-output-line.is-command .terminal-output-marker {
  color: #ffc1ad;
}

.terminal-ready-line {
  min-height: 20px;
  align-items: center;
}

.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--coral-accent);
  animation: caret-blink 1s steps(1) infinite;
}

@keyframes caret-blink {
  50% { opacity: 0; }
}

.terminal-presets {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: #0d1624;
}

.terminal-presets-label {
  color: #64748b;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.terminal-presets-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.terminal-preset {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-pill);
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  transition: all 120ms ease;
}

.terminal-preset:hover,
.terminal-preset.is-active {
  border-color: rgba(37, 99, 235, 0.4);
  background: rgba(37, 99, 235, 0.15);
  color: #ffffff;
}

.quickstart-steps {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.agent-loop-wrapper {
  padding: 16px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
}

.steps-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  list-style: none;
}

.step-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
  transition: border-color 140ms ease;
}

.step-card:hover {
  border-color: var(--hairline-strong);
}

.step-index {
  color: var(--accent);
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  margin-top: 2px;
}

.step-content h3 {
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}

.step-content p {
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.5;
  margin-top: 4px;
}

.step-content code {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12px;
}

/* ==========================================================================
   Bento Capabilities Grid
   ========================================================================== */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.bento-card {
  display: flex;
  flex-direction: column;
  padding: 28px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.bento-card:hover {
  border-color: rgba(37, 99, 235, 0.25);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.bento-card-lead {
  grid-column: span 2;
  background: linear-gradient(135deg, #ffffff 0%, var(--surface-1) 100%);
}

.bento-badge {
  display: inline-block;
  margin-bottom: 12px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--accent-subtle);
  color: var(--accent);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
}

.bento-card h3 {
  color: var(--ink);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 8px;
}

.bento-card p {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.6;
}

.bento-card-lead p {
  max-width: 58ch;
}

.subagents-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24px;
  padding: 16px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--canvas);
}

.supervisor-node {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-pill);
  background: var(--accent-subtle);
}

.node-badge {
  color: var(--accent);
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.node-title {
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
  font-weight: 600;
}

.subagent-branch-lines {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  height: 24px;
}

.subagent-branch-lines::before {
  position: absolute;
  top: 8px;
  right: calc(16.6667% - 2px);
  left: calc(16.6667% - 2px);
  height: 1.5px;
  background: var(--hairline-strong);
  content: '';
}

.branch-line {
  position: relative;
  z-index: 1;
  width: 1.5px;
  height: calc(100% - 8px);
  margin-top: 8px;
  justify-self: center;
  background: var(--hairline-strong);
}

.branch-line:nth-child(2) {
  height: 100%;
  margin-top: 0;
}

.subagent-children {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
}

.subagent-child {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.child-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.child-indicator {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
}

.child-indicator.is-running {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}

.child-indicator.is-done {
  background: var(--green-accent);
  box-shadow: 0 0 6px var(--green-accent);
}

.child-name {
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
}

.child-task {
  margin-left: 14px;
  color: var(--ink-subtle);
  font-size: 11px;
}

.bento-icon-tray {
  display: flex;
  gap: 12px;
  margin-top: auto;
  padding-top: 20px;
  opacity: 0.75;
}

.bento-code-pill {
  margin-top: auto;
  padding-top: 20px;
}

.bento-code-pill code {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
}

.bento-provider-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 20px;
}

.provider-chip {
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 500;
}

/* ==========================================================================
   Install Matrix
   ========================================================================== */
.command-list {
  overflow: hidden;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
}

.command-row {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 18px;
  padding: 10px 16px 10px 20px;
}

.command-row + .command-row {
  border-top: 1px solid var(--hairline-soft);
}

.platform-name {
  display: flex;
  min-width: 200px;
  align-items: center;
  gap: 12px;
}

.platform-icon-wrapper {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 7px;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  place-items: center;
}

.platform-brand-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.terminal-glyph {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--ink-muted);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.platform-title {
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
}

.command-code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
  white-space: nowrap;
}

.row-copy {
  position: relative;
  display: grid;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-subtle);
  cursor: pointer;
  place-items: center;
  transition: all 120ms ease;
}

.row-copy:hover {
  color: var(--ink);
  background: var(--surface-2);
  border-color: var(--hairline);
}

.row-copy svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.row-copy .check-icon {
  stroke: #059669;
}

.row-copy-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 3px 7px;
  border-radius: 5px;
  background: #09090b;
  color: #ffffff;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease, transform 120ms ease;
}

.row-copy:hover .row-copy-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ==========================================================================
   Plugin Section
   ========================================================================== */
.plugin-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.plugin-card {
  display: flex;
  flex-direction: column;
  padding: 28px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
  transition: all 160ms ease;
}

.plugin-card:hover {
  border-color: rgba(37, 99, 235, 0.2);
  box-shadow: var(--shadow-md);
}

.plugin-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.plugin-tag {
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.plugin-tag.official {
  background: rgba(37, 99, 235, 0.12);
  color: var(--accent);
}

.plugin-tag.curated {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.plugin-version {
  color: var(--ink-subtle);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
}

.plugin-card h3 {
  color: var(--ink);
  font-size: 19px;
  font-weight: 700;
  margin-bottom: 6px;
}

.plugin-card p {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 20px;
}

.plugin-install-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.plugin-install-box code {
  color: var(--ink);
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
}

/* ==========================================================================
   Documentation & Command Reference
   ========================================================================== */
.docs-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 32px;
}

.command-table-wrapper {
  overflow: hidden;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
}

.command-table {
  width: 100%;
  border-spacing: 0;
}

.command-table thead {
  background: var(--surface-1);
  border-bottom: 1px solid var(--hairline);
}

.command-table th[scope="col"] {
  padding: 12px 20px;
  color: var(--ink-subtle);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
}

.command-table td,
.command-table th[scope="row"] {
  padding: 14px 20px;
  text-align: left;
  border-top: 1px solid var(--hairline-soft);
}

.command-table th[scope="row"] {
  width: 160px;
  font-weight: 500;
}

.command-table code {
  color: var(--accent);
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
  font-weight: 600;
}

.command-table td {
  color: var(--ink-muted);
  font-size: 14px;
  line-height: 1.5;
}

.link-rail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.doc-card-link {
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--canvas);
  box-shadow: var(--shadow-sm);
  transition: all 140ms ease;
}

.doc-card-link:hover {
  border-color: rgba(37, 99, 235, 0.3);
  transform: translateY(-1px);
}

.doc-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.doc-card-title {
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
}

.arrow-icon {
  width: 14px;
  height: 14px;
  stroke: var(--ink-subtle);
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 120ms ease, stroke 120ms ease;
}

.doc-card-link:hover .arrow-icon {
  stroke: var(--accent);
  transform: translate(2px, -2px);
}

.doc-card-link small {
  margin-top: 4px;
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.4;
}

/* ==========================================================================
   Call to Action Panel
   ========================================================================== */
.cta-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 36px;
  padding: 48px;
  border-radius: var(--radius-xl);
  background: 
    radial-gradient(ellipse at 80% 20%, rgba(37, 99, 235, 0.25) 0%, transparent 50%),
    linear-gradient(135deg, #0f172a 0%, #020617 100%);
  color: #ffffff;
  box-shadow: var(--shadow-terminal);
}

.cta-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cta-badge {
  color: #93c5fd;
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.cta-panel h2 {
  font-size: clamp(28px, 3.2vw, 36px);
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: #ffffff;
}

.cta-desc {
  color: #94a3b8;
  font-size: 15px;
}

.cta-actions {
  display: flex;
  flex-shrink: 0;
  gap: 14px;
}

.cta-primary-btn {
  background: #ffffff;
  color: #09090b;
  border-color: #ffffff;
}

.cta-primary-btn:hover {
  background: #f1f5f9;
  border-color: #f1f5f9;
  box-shadow: 0 4px 18px rgba(255, 255, 255, 0.25);
}

.cta-secondary-btn {
  background: transparent;
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.2);
}

.cta-secondary-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.4);
}

/* ==========================================================================
   Site Footer
   ========================================================================== */

.site-footer {
  margin-top: 112px;
  padding-block: 56px;
  border-top: 1px solid var(--hairline);
  background: var(--canvas);
}

.footer-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-wordmark {
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
}

.footer-version {
  color: var(--ink-subtle);
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
}

.footer-caption {
  margin-top: 8px;
  color: var(--ink-subtle);
  font-size: 13px;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 24px;
}

.footer-links a {
  color: var(--ink-muted);
  font-size: 13px;
  font-weight: 500;
  transition: color 120ms ease;
}

.footer-links a:hover {
  color: var(--ink);
}

/* ==========================================================================
   Responsive Breakpoints
   ========================================================================== */
@media (max-width: 960px) {
  .hero {
    gap: 36px;
    padding-top: 36px;
    padding-bottom: 32px;
    min-height: auto;
  }

  .hero-main-grid {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .hero-greeting {
    top: 0;
    right: 0;
    bottom: auto;
    left: auto;
  }


  .hero-preview {
    width: 100%;
    max-width: 520px;
    margin-right: 0;
    margin-inline: auto;
  }

  .hero-providers-bar {
    padding: 8px 14px;
    border-radius: var(--radius-md);
  }

  .vscode-grid,
  .quickstart-grid,
  .docs-grid {
    grid-template-columns: 1fr;
  }

  .bento-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .bento-card-lead {
    grid-column: span 2;
  }

  .cta-panel {
    flex-direction: column;
    align-items: flex-start;
    padding: 36px;
  }
}

@media (max-width: 768px) {
  .nav-links {
    display: none;
  }

  .mobile-menu {
    display: block;
  }

  .bento-grid {
    grid-template-columns: 1fr;
  }

  .bento-card-lead {
    grid-column: span 1;
  }

  .plugin-grid {
    grid-template-columns: 1fr;
  }

  .command-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 16px;
  }

  .platform-name {
    min-width: 0;
    width: 100%;
  }

  .command-code {
    width: 100%;
  }

  .row-copy {
    align-self: flex-end;
    margin-top: -38px;
  }

  .footer-inner {
    flex-direction: column;
  }

  .footer-links {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .hero-title {
    font-size: clamp(40px, 9vw, 52px);
  }

  .hero-lead {
    font-size: 17px;
  }

  .hero-download-buttons {
    flex-direction: column;
    width: 100%;
  }

  .button-download-mac,
  .button-download-win {
    width: 100%;
  }

  .terminal-title {
    display: none;
  }

  .terminal-mode {
    margin-left: auto;
  }

  .cta-actions {
    flex-direction: column;
    width: 100%;
  }

  .cta-primary-btn,
  .cta-secondary-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
