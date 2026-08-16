<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const containerRef = ref(null);
const canvasRef = ref(null);

let ctx;
let animId;
let width = 0;
let height = 0;
let isMounted = false;
let isVisible = true;
let prefersReducedMotion = false;
let resizeObserver;
let intersectionObserver;

// Interactive pointer with smooth lerp
const pointer = {
  x: -1000,
  y: -1000,
  targetX: -1000,
  targetY: -1000,
  active: false,
};

// Procedural system state
const GRID_SIZE = 48;
let nodes = [];
let telemetryBeams = [];

// Color tokens derived from brand identity (Pythinker electric blue & cyan telemetry)
const COLORS = {
  gridLine: 'rgba(255, 255, 255, 0.024)',
  gridCrosshair: 'rgba(147, 197, 253, 0.12)',
  activeCrosshair: 'rgba(56, 189, 248, 0.45)',
  beamHead: 'rgba(96, 165, 250, 0.85)',
  beamCyan: 'rgba(56, 189, 248, 0.65)',
  nodeIdle: 'rgba(148, 163, 184, 0.22)',
  nodeAccent: 'rgba(59, 130, 246, 0.55)',
  edgeLine: 'rgba(59, 130, 246, 0.09)',
};

function initNodes() {
  const isSmall = width < 768;
  const count = isSmall ? 18 : 34;
  
  nodes = Array.from({ length: count }, () => {
    const homeX = Math.random() * width;
    const homeY = Math.random() * height;
    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,
      vx: 0,
      vy: 0,
      radius: 1 + Math.random() * 1.2,
      baseAlpha: 0.15 + Math.random() * 0.25,
      pulseSpeed: 0.02 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      isAccent: Math.random() < 0.25,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: 0.12 + Math.random() * 0.2,
    };
  });
}

function initTelemetryBeams() {
  const beamCount = Math.max(3, Math.min(7, Math.floor(width / 240)));
  telemetryBeams = Array.from({ length: beamCount }, () => {
    const isHorizontal = Math.random() > 0.4;
    const maxBound = isHorizontal ? height : width;
    const gridCoord = Math.round((Math.random() * maxBound) / GRID_SIZE) * GRID_SIZE;
    const length = 70 + Math.random() * 100;
    const travelMax = isHorizontal ? width : height;
    
    return {
      isHorizontal,
      coord: gridCoord,
      pos: Math.random() * travelMax,
      speed: 1.2 + Math.random() * 1.6,
      length,
      alpha: 0.25 + Math.random() * 0.25,
      focalWeight: 0.8 + Math.random() * 0.4,
    };
  });
}

function handleResize() {
  if (!containerRef.value || !canvasRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  width = rect.width || window.innerWidth;
  height = rect.height || 640;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasRef.value.width = Math.round(width * dpr);
  canvasRef.value.height = Math.round(height * dpr);

  ctx = canvasRef.value.getContext('2d', { alpha: true });
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  initNodes();
  initTelemetryBeams();

  if (prefersReducedMotion) {
    renderStaticState();
  }
}

function updatePhysics() {
  // Smooth pointer interpolation
  pointer.x += (pointer.targetX - pointer.x) * 0.12;
  pointer.y += (pointer.targetY - pointer.y) * 0.12;

  // Update nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n.phase += n.pulseSpeed;

    // Organic drift
    n.homeX += Math.cos(n.driftAngle + n.phase * 0.15) * (n.driftSpeed * 0.5);
    n.homeY += Math.sin(n.driftAngle + n.phase * 0.15) * (n.driftSpeed * 0.5);

    // Bounding
    if (n.homeX < -20) n.homeX = width + 20;
    if (n.homeX > width + 20) n.homeX = -20;
    if (n.homeY < -20) n.homeY = height + 20;
    if (n.homeY > height + 20) n.homeY = -20;

    // Pointer repulsion / interaction
    if (pointer.active) {
      const dx = n.x - pointer.x;
      const dy = n.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      const repulseDist = 120;

      if (dist < repulseDist && dist > 0.01) {
        const force = ((repulseDist - dist) / repulseDist) * 1.5;
        n.vx += (dx / dist) * force;
        n.vy += (dy / dist) * force;
      }
    }

    // Spring restitution
    n.vx += (n.homeX - n.x) * 0.02;
    n.vy += (n.homeY - n.y) * 0.02;
    n.vx *= 0.88;
    n.vy *= 0.88;
    n.x += n.vx;
    n.y += n.vy;
  }

  // Update telemetry beams
  for (let i = 0; i < telemetryBeams.length; i++) {
    const beam = telemetryBeams[i];
    beam.pos += beam.speed;
    const maxBound = beam.isHorizontal ? width : height;

    if (beam.pos - beam.length > maxBound) {
      beam.pos = -beam.length;
      beam.isHorizontal = Math.random() > 0.45;
      const crossBound = beam.isHorizontal ? height : width;
      beam.coord = Math.round((Math.random() * crossBound) / GRID_SIZE) * GRID_SIZE;
      beam.speed = 1.2 + Math.random() * 1.6;
      beam.alpha = 0.2 + Math.random() * 0.25;
    }
  }
}

function renderFrame() {
  if (!ctx || !isVisible) return;
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Mathematical Coordinate Grid Lines
  ctx.save();
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;

  // Vertical lines
  ctx.beginPath();
  for (let x = GRID_SIZE; x < width; x += GRID_SIZE) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  // Horizontal lines
  for (let y = GRID_SIZE; y < height; y += GRID_SIZE) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // 2. Draw Precision Grid Crosshairs & Micro-Nodes
  const pX = pointer.x;
  const pY = pointer.y;
  const spotlightRadius = 220;

  for (let x = GRID_SIZE; x < width; x += GRID_SIZE) {
    for (let y = GRID_SIZE; y < height; y += GRID_SIZE) {
      const dist = pointer.active ? Math.hypot(x - pX, y - pY) : 999;
      let alpha = 0.12;

      // Spotlight illumination
      if (dist < spotlightRadius) {
        const factor = 1 - dist / spotlightRadius;
        alpha += factor * factor * 0.65;
      }

      // Draw subtle precision crosshair at grid intersections
      const arm = 3;
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.strokeStyle = dist < spotlightRadius ? `rgba(96, 165, 250, ${alpha})` : `rgba(255, 255, 255, ${alpha * 0.35})`;
      ctx.stroke();
    }
  }

  // 3. Draw Autonomous Agent Telemetry Beams (code execution traces)
  for (let i = 0; i < telemetryBeams.length; i++) {
    const beam = telemetryBeams[i];
    ctx.beginPath();
    ctx.lineWidth = 1.4;

    if (beam.isHorizontal) {
      const startX = Math.max(0, beam.pos - beam.length);
      const endX = Math.min(width, beam.pos);
      if (startX < endX) {
        const grad = ctx.createLinearGradient(startX, beam.coord, endX, beam.coord);
        grad.addColorStop(0, 'rgba(37, 99, 235, 0)');
        grad.addColorStop(0.7, `rgba(56, 189, 248, ${beam.alpha * 0.8})`);
        grad.addColorStop(1, `rgba(147, 197, 253, ${beam.alpha * 1.4})`);
        ctx.strokeStyle = grad;
        ctx.moveTo(startX, beam.coord);
        ctx.lineTo(endX, beam.coord);
        ctx.stroke();

        // Beam head particle
        ctx.beginPath();
        ctx.arc(endX, beam.coord, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.beamHead;
        ctx.fill();
      }
    } else {
      const startY = Math.max(0, beam.pos - beam.length);
      const endY = Math.min(height, beam.pos);
      if (startY < endY) {
        const grad = ctx.createLinearGradient(beam.coord, startY, beam.coord, endY);
        grad.addColorStop(0, 'rgba(37, 99, 235, 0)');
        grad.addColorStop(0.7, `rgba(56, 189, 248, ${beam.alpha * 0.8})`);
        grad.addColorStop(1, `rgba(147, 197, 253, ${beam.alpha * 1.4})`);
        ctx.strokeStyle = grad;
        ctx.moveTo(beam.coord, startY);
        ctx.lineTo(beam.coord, endY);
        ctx.stroke();

        // Beam head particle
        ctx.beginPath();
        ctx.arc(beam.coord, endY, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.beamHead;
        ctx.fill();
      }
    }
  }

  // 4. Draw Interconnected Agent Graph Nodes
  ctx.strokeStyle = COLORS.edgeLine;
  ctx.lineWidth = 0.8;
  const maxEdgeDist = 72;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i];
      const n2 = nodes[j];
      const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
      if (dist < maxEdgeDist) {
        const edgeAlpha = (1 - dist / maxEdgeDist) * 0.16;
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.strokeStyle = `rgba(59, 130, 246, ${edgeAlpha})`;
        ctx.stroke();
      }
    }
  }

  // Draw node points
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const pulseAlpha = n.baseAlpha + Math.sin(n.phase) * 0.12;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

    if (n.isAccent) {
      ctx.fillStyle = `rgba(96, 165, 250, ${Math.max(0.08, pulseAlpha * 1.5)})`;
    } else {
      ctx.fillStyle = `rgba(148, 163, 184, ${Math.max(0.05, pulseAlpha)})`;
    }
    ctx.fill();
  }

  ctx.restore();
}

function renderStaticState() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;

  for (let x = GRID_SIZE; x < width; x += GRID_SIZE) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = GRID_SIZE; y < height; y += GRID_SIZE) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Draw static quiet crosshairs
  for (let x = GRID_SIZE * 2; x < width; x += GRID_SIZE * 2) {
    for (let y = GRID_SIZE * 2; y < height; y += GRID_SIZE * 2) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(147, 197, 253, 0.08)';
      ctx.fill();
    }
  }
  ctx.restore();
}

function loop() {
  if (!isVisible || prefersReducedMotion) return;
  updatePhysics();
  renderFrame();
  animId = requestAnimationFrame(loop);
}

function startLoop() {
  if (animId !== undefined || document.hidden || !isVisible || prefersReducedMotion) return;
  animId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (animId === undefined) return;
  cancelAnimationFrame(animId);
  animId = undefined;
}

function onPointerMove(e) {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  pointer.targetX = e.clientX - rect.left;
  pointer.targetY = e.clientY - rect.top;
  pointer.active = true;
}

function onPointerLeave() {
  pointer.active = false;
  pointer.targetX = -1000;
  pointer.targetY = -1000;
}

function onVisibilityChange() {
  if (document.hidden) stopLoop();
  else if (isVisible) startLoop();
}

onMounted(async () => {
  isMounted = true;
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await nextTick();
  if (!isMounted || !containerRef.value) return;

  handleResize();

  // IntersectionObserver to pause rendering when hero is out of view
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      isVisible = entry.isIntersecting;
      if (isVisible && !prefersReducedMotion) {
        startLoop();
      } else {
        stopLoop();
      }
    },
    { threshold: 0.05 }
  );
  intersectionObserver.observe(containerRef.value);

  // ResizeObserver on the container
  resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  resizeObserver.observe(containerRef.value);

  // Pointer listeners attached to hero container
  const containerEl = containerRef.value;
  containerEl.addEventListener('pointermove', onPointerMove, { passive: true });
  containerEl.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (!prefersReducedMotion && isVisible) {
    startLoop();
  }
});

onUnmounted(() => {
  isMounted = false;
  stopLoop();
  if (resizeObserver) resizeObserver.disconnect();
  if (intersectionObserver) intersectionObserver.disconnect();
  if (containerRef.value) {
    containerRef.value.removeEventListener('pointermove', onPointerMove);
    containerRef.value.removeEventListener('pointerleave', onPointerLeave);
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <div ref="containerRef" class="hero-background-system" aria-hidden="true">
    <!-- Volumetric Ambient Lighting Layer -->
    <div class="hero-light-layer">
      <div class="glow-focal-primary"></div>
      <div class="glow-focal-secondary"></div>
      <div class="vignette-overlay"></div>
    </div>
    
    <!-- Procedural Precision Matrix Canvas -->
    <canvas ref="canvasRef" class="hero-canvas"></canvas>
  </div>
</template>

<style scoped>
.hero-background-system {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: auto;
  contain: strict;
  z-index: 0;
}

.hero-light-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Primary focal illumination centered behind desktop preview */
.glow-focal-primary {
  position: absolute;
  top: 35%;
  right: 18%;
  width: clamp(420px, 45vw, 680px);
  height: clamp(380px, 40vw, 600px);
  transform: translate(25%, -30%);
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(37, 99, 235, 0.22) 0%,
    rgba(14, 40, 85, 0.16) 45%,
    transparent 72%
  );
  filter: blur(80px);
  opacity: 0.9;
  will-change: transform;
}

/* Secondary subtle accent illumination on the top-left */
.glow-focal-secondary {
  position: absolute;
  top: -10%;
  left: -8%;
  width: clamp(320px, 35vw, 500px);
  height: clamp(320px, 35vw, 500px);
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(56, 189, 248, 0.1) 0%,
    rgba(37, 99, 235, 0.05) 50%,
    transparent 70%
  );
  filter: blur(90px);
  opacity: 0.7;
}

/* Soft contrast preservation vignette for maximum text legibility */
.vignette-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 25% 45%,
    rgba(7, 13, 24, 0.4) 0%,
    transparent 65%
  );
  pointer-events: none;
}

.hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

@media (max-width: 960px) {
  .glow-focal-primary {
    top: 55%;
    right: 50%;
    transform: translate(50%, -20%);
    width: 90vw;
    height: 400px;
    opacity: 0.8;
  }
}

@media (prefers-reduced-motion: reduce) {
  .glow-focal-primary,
  .glow-focal-secondary {
    filter: blur(60px);
  }
}
</style>
