<script setup>
import { ref } from 'vue';

const visible = ref(true);
</script>

<template>
  <Transition name="download-popup" appear>
    <aside v-if="visible" class="download-popup" aria-labelledby="download-popup-title">
      <span class="download-popup-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18h14" />
        </svg>
      </span>

      <div class="download-popup-content">
        <p class="download-popup-kicker">Community milestone</p>
        <h2 id="download-popup-title">30K+ Python downloads</h2>
        <p class="download-popup-copy">Our previous Python version passed 30,000 downloads.</p>
        <a
          class="download-popup-badge"
          href="https://pepy.tech/projects/pythinker-code"
          target="_blank"
          rel="noopener"
          aria-label="View pythinker-code download statistics on Pepy"
        >
          <img
            src="https://static.pepy.tech/personalized-badge/pythinker-code?period=total&amp;units=INTERNATIONAL_SYSTEM&amp;left_color=BLACK&amp;right_color=GREEN&amp;left_text=downloads"
            alt="PyPI download count for pythinker-code"
            height="20"
          />
        </a>
      </div>

      <button class="download-popup-close" type="button" aria-label="Dismiss download milestone" @click="visible = false">
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </aside>
  </Transition>
</template>

<style scoped>
.download-popup {
  position: relative;
  z-index: 1;
  display: grid;
  width: min(360px, 100%);
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 14px;
  padding: 18px 48px 18px 18px;
  border: 1px solid rgba(43, 137, 255, 0.2);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 24px 64px rgba(16, 38, 60, 0.18),
    0 4px 16px rgba(16, 38, 60, 0.08);
  backdrop-filter: blur(14px);
}

.download-popup-mark {
  display: grid;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(43, 137, 255, 0.1);
  color: var(--accent);
  place-items: center;
}

.download-popup-mark svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.download-popup-content {
  min-width: 0;
}

.download-popup-kicker {
  color: var(--accent);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.4;
  text-transform: uppercase;
}

.download-popup h2 {
  margin-top: 3px;
  color: var(--ink);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.download-popup-copy {
  margin-top: 5px;
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.5;
}

.download-popup-badge {
  display: inline-flex;
  margin-top: 12px;
  border-radius: 4px;
}

.download-popup-badge img {
  display: block;
  width: auto;
  max-width: 100%;
  height: 20px;
}

.download-popup-close {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 36px;
  height: 36px;
  padding: 9px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-subtle);
  cursor: pointer;
  place-items: center;
}

.download-popup-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.download-popup-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.6;
}

.download-popup-enter-active,
.download-popup-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.download-popup-enter-from,
.download-popup-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 480px) {
  .download-popup {
    width: 100%;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 12px;
    padding: 14px 44px 14px 14px;
  }

  .download-popup-mark {
    width: 38px;
    height: 38px;
    border-radius: 12px;
  }

  .download-popup-mark svg {
    width: 20px;
    height: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-popup-enter-active,
  .download-popup-leave-active {
    transition: none;
  }
}
</style>
