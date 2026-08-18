<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { computed, ref } from 'vue'

const { lang } = useData()
const isZh = computed(() => lang.value.startsWith('zh'))

const installMacCommand = 'curl -fsSL https://code.kimi.com/pythinker-code/install.sh | bash'
const installWinCommand = 'irm https://code.kimi.com/pythinker-code/install.ps1 | iex'
const runCommand = 'pythinker'

const copy = computed(() => isZh.value
  ? {
      title: '一行命令开始',
      lede: '装好之后跑 pythinker，立刻在你当前的项目里开聊。',
      macLabel: 'macOS / Linux',
      winLabel: 'Windows (PowerShell)',
      runLabel: '在任意目录运行',
      copyHint: '复制',
      copiedHint: '已复制',
      ctaText: '查看完整安装指南',
      ctaHref: '/zh/guides/getting-started',
    }
  : {
      title: 'Get started in one line',
      lede: 'Once installed, run pythinker inside any project to start a conversation.',
      macLabel: 'macOS / Linux',
      winLabel: 'Windows (PowerShell)',
      runLabel: 'Run anywhere',
      copyHint: 'Copy',
      copiedHint: 'Copied',
      ctaText: 'Read the full install guide',
      ctaHref: '/en/guides/getting-started',
    })

const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function copyText(value: string, key: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(value).then(() => {
    copiedKey.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedKey.value = null }, 1600)
  })
}
</script>

<template>
  <section class="PythinkerHome__section PythinkerQuick">
    <h2 class="PythinkerHome__sectionTitle">{{ copy.title }}</h2>
    <p class="PythinkerHome__sectionLede">{{ copy.lede }}</p>

    <div class="PythinkerQuick__installs">
      <div class="PythinkerQuick__block">
        <div class="PythinkerQuick__label">{{ copy.macLabel }}</div>
        <div class="PythinkerQuick__cmd">
          <code><span class="PythinkerQuick__prompt">$</span> {{ installMacCommand }}</code>
          <button
            type="button"
            class="PythinkerQuick__copy"
            @click="copyText(installMacCommand, 'mac')"
            :aria-label="copy.copyHint"
          >
            <template v-if="copiedKey === 'mac'">{{ copy.copiedHint }}</template>
            <template v-else>{{ copy.copyHint }}</template>
          </button>
        </div>
      </div>

      <div class="PythinkerQuick__block">
        <div class="PythinkerQuick__label">{{ copy.winLabel }}</div>
        <div class="PythinkerQuick__cmd">
          <code><span class="PythinkerQuick__prompt">PS&gt;</span> {{ installWinCommand }}</code>
          <button
            type="button"
            class="PythinkerQuick__copy"
            @click="copyText(installWinCommand, 'win')"
            :aria-label="copy.copyHint"
          >
            <template v-if="copiedKey === 'win'">{{ copy.copiedHint }}</template>
            <template v-else>{{ copy.copyHint }}</template>
          </button>
        </div>
      </div>
    </div>

    <div class="PythinkerQuick__block PythinkerQuick__block--run">
      <div class="PythinkerQuick__label">{{ copy.runLabel }}</div>
      <div class="PythinkerQuick__cmd">
        <code><span class="PythinkerQuick__prompt">$</span> {{ runCommand }}</code>
        <button
          type="button"
          class="PythinkerQuick__copy"
          @click="copyText(runCommand, 'run')"
          :aria-label="copy.copyHint"
        >
          <template v-if="copiedKey === 'run'">{{ copy.copiedHint }}</template>
          <template v-else>{{ copy.copyHint }}</template>
        </button>
      </div>
    </div>

    <a class="PythinkerQuick__more" :href="withBase(copy.ctaHref)">
      {{ copy.ctaText }}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </a>
  </section>
</template>

<style scoped>
.PythinkerQuick__installs {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.PythinkerQuick__block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PythinkerQuick__block--run {
  margin-bottom: 28px;
}

.PythinkerQuick__label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.PythinkerQuick__cmd {
  position: relative;
  display: flex;
  align-items: center;
  padding: 18px 22px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--pythinker-radius-code);
  font-family: var(--vp-font-family-mono);
  font-size: 14.5px;
  line-height: 1.4;
  color: var(--vp-c-text-1);
  overflow: hidden;
  transition: border-color var(--pythinker-transition), box-shadow var(--pythinker-transition);
}
.PythinkerQuick__cmd:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: var(--vp-shadow-2);
}
.PythinkerQuick__cmd code {
  flex: 1;
  white-space: pre;
  overflow-x: auto;
  background: transparent !important;
  color: inherit;
  padding: 0;
  font-size: inherit;
  font-family: inherit;
  border-radius: 0;
}
.PythinkerQuick__prompt {
  color: var(--vp-c-brand-1);
  margin-right: 8px;
  user-select: none;
  font-weight: 600;
}

.PythinkerQuick__copy {
  flex: none;
  margin-left: 12px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--vp-font-family-base);
  letter-spacing: 0.01em;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: color var(--pythinker-transition), border-color var(--pythinker-transition), background var(--pythinker-transition);
}
.PythinkerQuick__copy:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.PythinkerQuick__more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  transition: transform var(--pythinker-transition), color var(--pythinker-transition);
}
.PythinkerQuick__more:hover {
  color: var(--vp-c-brand-2);
  transform: translateX(3px);
}
</style>
