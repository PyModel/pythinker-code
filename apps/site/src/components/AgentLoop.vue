<template>
  <div class="agent-loop">
    <span class="visually-hidden">The agent loops: plan, execute, observe, iterate.</span>
    <svg viewBox="0 0 320 180" width="100%" aria-hidden="true">
      <rect class="loop-base" x="50" y="40" width="220" height="100" rx="28" />
      <rect class="loop-progress" x="50" y="40" width="220" height="100" rx="28" />
      <circle cx="160" cy="40" r="4" />
      <circle cx="270" cy="90" r="4" />
      <circle cx="160" cy="140" r="4" />
      <circle cx="50" cy="90" r="4" />
      <text x="160" y="22" text-anchor="middle">Plan</text>
      <text x="284" y="94">Execute</text>
      <text x="160" y="166" text-anchor="middle">Observe</text>
      <text x="36" y="94" text-anchor="end">Iterate</text>
    </svg>
  </div>
</template>

<style scoped>
.agent-loop {
  width: 100%;
}

svg {
  display: block;
}

rect {
  fill: none;
}

.loop-base {
  stroke: rgba(17, 17, 19, 0.15);
  stroke-width: 1;
}

.loop-progress {
  stroke: var(--accent);
  stroke-dasharray: 40 660;
  stroke-width: 1.5;
  animation: loop-travel 6s linear infinite;
}

circle {
  fill: #d1d1d5;
}

text {
  fill: var(--ink-subtle);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

@keyframes loop-travel {
  to {
    stroke-dashoffset: -700;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loop-progress {
    animation: none;
  }
}
</style>
