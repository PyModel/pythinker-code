<template>
  <div class="agent-loop" aria-label="The autonomous agent loop: Plan, Execute, Observe, Iterate">
    <span class="visually-hidden">The autonomous loop: Plan, Execute, Observe, Iterate.</span>
    <svg viewBox="0 0 320 160" width="100%" aria-hidden="true">
      <defs>
        <linearGradient id="loopGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2" />
          <stop offset="50%" stop-color="var(--accent)" stop-opacity="1" />
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.6" />
        </linearGradient>
        <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="var(--accent)" flood-opacity="0.4" />
        </filter>
      </defs>
      
      <!-- Base track -->
      <rect class="loop-base" x="60" y="38" width="200" height="84" rx="24" />
      
      <!-- Animated energy trail -->
      <rect class="loop-progress" x="60" y="38" width="200" height="84" rx="24" />
      
      <!-- Step Nodes -->
      <g class="loop-node" transform="translate(160, 38)">
        <circle cx="0" cy="0" r="5.5" class="node-outer" />
        <circle cx="0" cy="0" r="2.5" class="node-inner" />
      </g>
      <g class="loop-node" transform="translate(260, 80)">
        <circle cx="0" cy="0" r="5.5" class="node-outer" />
        <circle cx="0" cy="0" r="2.5" class="node-inner" />
      </g>
      <g class="loop-node" transform="translate(160, 122)">
        <circle cx="0" cy="0" r="5.5" class="node-outer" />
        <circle cx="0" cy="0" r="2.5" class="node-inner" />
      </g>
      <g class="loop-node" transform="translate(60, 80)">
        <circle cx="0" cy="0" r="5.5" class="node-outer" />
        <circle cx="0" cy="0" r="2.5" class="node-inner" />
      </g>
      
      <!-- Step Labels -->
      <text x="160" y="20" text-anchor="middle" class="step-label">Plan</text>
      <text x="272" y="84" class="step-label">Execute</text>
      <text x="160" y="150" text-anchor="middle" class="step-label">Observe</text>
      <text x="48" y="84" text-anchor="end" class="step-label">Iterate</text>
    </svg>
  </div>
</template>

<style scoped>
.agent-loop {
  width: 100%;
  padding-inline: 4px;
}

svg {
  display: block;
  overflow: visible;
}

rect {
  fill: none;
}

.loop-base {
  stroke: rgba(10, 10, 12, 0.1);
  stroke-width: 1.5;
}

.loop-progress {
  stroke: url(#loopGradient);
  stroke-dasharray: 52 568;
  stroke-width: 2;
  stroke-linecap: round;
  animation: loop-travel 6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.node-outer {
  fill: var(--canvas);
  stroke: var(--hairline-strong);
  stroke-width: 1.5;
}

.node-inner {
  fill: var(--accent);
}

.step-label {
  fill: var(--ink-muted);
  font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  transition: fill 200ms ease;
}

.agent-loop:hover .step-label {
  fill: var(--ink);
}

@keyframes loop-travel {
  to {
    stroke-dashoffset: -620;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loop-progress {
    animation: none;
    stroke: var(--accent);
    stroke-dasharray: none;
  }
}
</style>
