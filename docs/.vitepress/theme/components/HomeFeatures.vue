<script setup lang="ts">
import { withBase } from 'vitepress'

interface Highlight {
  icon: string
  title: string
  desc: string
}

interface Feature {
  icon: string
  title: string
  desc: string
  href: string
}

const highlights: Highlight[] = [
  {
    icon: '⚡',
    title: 'Fast & lightweight',
    desc: 'Single-binary install with millisecond startup — no Node.js, no PATH gymnastics.',
  },
  {
    icon: '🎬',
    title: 'Video input',
    desc: 'Drop a screen recording or demo clip in chat; the agent reads the frames and acts on them.',
  },
  {
    icon: '🎨',
    title: 'Polished TUI',
    desc: 'A carefully tuned interface designed for long, focused agent sessions.',
  },
]

const features: Feature[] = [
  {
    icon: '🧩',
    title: 'Agent Skills',
    desc: "Package your team's workflows into skills Pythinker can invoke on demand.",
    href: '/customization/skills',
  },
  {
    icon: '🪝',
    title: 'Hooks',
    desc: 'Inject scripts at lifecycle checkpoints — formatting, approvals, notifications, anything.',
    href: '/customization/hooks',
  },
  {
    icon: '🤖',
    title: 'Sub-agents',
    desc: 'Dispatch isolated tasks in parallel, each with its own context — main thread stays clean.',
    href: '/customization/agents',
  },
  {
    icon: '🔌',
    title: 'MCP',
    desc: 'Plug in any tool, data source, or enterprise system via the Model Context Protocol.',
    href: '/customization/mcp',
  },
]

const highlightsTitle = 'Ready out of the box'
const highlightsLede = 'Install once. The essentials are already there.'
const featuresTitle = 'Extend it your way'
const featuresLede = 'Programmable extension points to shape the workflow around you.'
const ctaText = 'Learn more'
</script>

<template>
  <section class="PythinkerHome__section PythinkerHighlights">
    <h2 class="PythinkerHome__sectionTitle">{{ highlightsTitle }}</h2>
    <p class="PythinkerHome__sectionLede">{{ highlightsLede }}</p>
    <div class="PythinkerHighlights__grid">
      <div
        v-for="h in highlights"
        :key="h.title"
        class="PythinkerHighlights__card"
      >
        <div class="PythinkerHighlights__icon" aria-hidden="true">{{ h.icon }}</div>
        <h3 class="PythinkerHighlights__title">{{ h.title }}</h3>
        <p class="PythinkerHighlights__desc">{{ h.desc }}</p>
      </div>
    </div>
  </section>

  <section class="PythinkerHome__section PythinkerFeatures">
    <h2 class="PythinkerHome__sectionTitle">{{ featuresTitle }}</h2>
    <p class="PythinkerHome__sectionLede">{{ featuresLede }}</p>
    <div class="PythinkerFeatures__grid">
      <a
        v-for="f in features"
        :key="f.title"
        class="PythinkerFeatures__card"
        :href="withBase(f.href)"
      >
        <div class="PythinkerFeatures__icon" aria-hidden="true">{{ f.icon }}</div>
        <h3 class="PythinkerFeatures__title">{{ f.title }}</h3>
        <p class="PythinkerFeatures__desc">{{ f.desc }}</p>
        <span class="PythinkerFeatures__cta">
          {{ ctaText }}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </a>
    </div>
  </section>
</template>

<style scoped>
/* === Highlights (top section: non-clickable product attributes) === */
.PythinkerHighlights__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 720px) {
  .PythinkerHighlights__grid {
    grid-template-columns: 1fr;
  }
}

.PythinkerHighlights__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 22px 22px 24px;
  border-radius: var(--pythinker-radius-card);
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.PythinkerHighlights__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--pythinker-brand-soft);
  font-size: 18px;
  margin-bottom: 14px;
}

.PythinkerHighlights__title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0 0 6px;
  color: var(--vp-c-text-1);
}

.PythinkerHighlights__desc {
  font-size: 14px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  margin: 0;
}

/* === Features (bottom section: clickable extension points) === */
.PythinkerFeatures__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

@media (max-width: 1024px) {
  .PythinkerFeatures__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .PythinkerFeatures__grid {
    grid-template-columns: 1fr;
  }
}

.PythinkerFeatures__card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 28px 24px 26px;
  border-radius: var(--pythinker-radius-card);
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: transform var(--pythinker-transition), border-color var(--pythinker-transition),
              box-shadow var(--pythinker-transition), background var(--pythinker-transition);
  overflow: hidden;
}

.PythinkerFeatures__card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--pythinker-brand-gradient-soft);
  opacity: 0;
  transition: opacity var(--pythinker-transition);
  pointer-events: none;
  border-radius: inherit;
}

.PythinkerFeatures__card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: var(--vp-shadow-3);
}
.PythinkerFeatures__card:hover::before {
  opacity: 1;
}

.PythinkerFeatures__icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--pythinker-brand-soft);
  font-size: 22px;
  margin-bottom: 18px;
}

.PythinkerFeatures__title {
  position: relative;
  z-index: 1;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.015em;
  margin: 0 0 8px;
  color: var(--vp-c-text-1);
}

.PythinkerFeatures__desc {
  position: relative;
  z-index: 1;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 20px;
}

.PythinkerFeatures__cta {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-top: auto;
  transition: transform var(--pythinker-transition);
}

.PythinkerFeatures__card:hover .PythinkerFeatures__cta {
  transform: translateX(3px);
}
</style>
