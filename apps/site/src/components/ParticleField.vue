<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const canvas = ref(null);
const enabled = ref(false);

let context;
let animationFrame;
let viewportWidth = 0;
let viewportHeight = 0;
let mounted = false;
let scrollY = 0;
let prefersReducedMotion = false;

const pointer = { x: -1000, y: -1000, targetX: -1000, targetY: -1000, active: false };
const GRID_SIZE = 48;

// Procedural micro-particles with natural drift
let particles = [];
// Procedural grid pulses representing autonomous agent activity
let gridPulses = [];

function initParticles() {
  const densityFactor = (viewportWidth * viewportHeight) / 18000;
  const count = Math.max(30, Math.min(75, Math.round(densityFactor)));
  
  particles = Array.from({ length: count }, () => {
    const homeX = Math.random() * viewportWidth;
    const homeY = Math.random() * viewportHeight;
    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,
      vx: 0,
      vy: 0,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: 0.15 + Math.random() * 0.25,
      radius: 0.8 + Math.random() * 0.9,
      baseAlpha: 0.12 + Math.random() * 0.2,
      isAccent: Math.random() < 0.15,
      phase: Math.random() * Math.PI * 2,
    };
  });
}

function initGridPulses() {
  const pulseCount = Math.max(2, Math.min(5, Math.floor(viewportWidth / 360)));
  gridPulses = Array.from({ length: pulseCount }, () => {
    const isHorizontal = Math.random() > 0.5;
    const gridCoord = Math.floor(Math.random() * (isHorizontal ? viewportHeight : viewportWidth) / GRID_SIZE) * GRID_SIZE;
    return {
      isHorizontal,
      coord: gridCoord,
      pos: Math.random() * (isHorizontal ? viewportWidth : viewportHeight),
      speed: 0.6 + Math.random() * 0.8,
      length: 60 + Math.random() * 80,
      alpha: 0.18 + Math.random() * 0.14,
    };
  });
}

function resize() {
  if (!canvas.value) return;
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  scrollY = window.scrollY || window.pageYOffset || 0;
  
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.value.width = Math.round(viewportWidth * dpr);
  canvas.value.height = Math.round(viewportHeight * dpr);
  
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  
  initParticles();
  initGridPulses();
  
  if (prefersReducedMotion) {
    renderStaticBackground();
  }
}

function updateSimulation() {
  // Smooth pointer interpolation
  pointer.x += (pointer.targetX - pointer.x) * 0.12;
  pointer.y += (pointer.targetY - pointer.y) * 0.12;

  // Update floating particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.phase += 0.015;
    p.homeX += Math.cos(p.driftAngle + p.phase * 0.2) * (p.driftSpeed * 0.4);
    p.homeY += Math.sin(p.driftAngle + p.phase * 0.2) * (p.driftSpeed * 0.4);

    // Screen wrapping
    if (p.homeX < -20) p.homeX = viewportWidth + 20;
    if (p.homeX > viewportWidth + 20) p.homeX = -20;
    if (p.homeY < -20) p.homeY = viewportHeight + 20;
    if (p.homeY > viewportHeight + 20) p.homeY = -20;

    // Pointer repulsion physics
    if (pointer.active) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      const interactRadius = 140;

      if (dist < interactRadius && dist > 0.01) {
        const force = ((interactRadius - dist) / interactRadius) * 1.2;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
    }

    // Spring return to home position
    p.vx += (p.homeX - p.x) * 0.01;
    p.vy += (p.homeY - p.y) * 0.01;
    p.vx *= 0.9;
    p.vy *= 0.9;
    p.x += p.vx;
    p.y += p.vy;
  }

  // Update procedural grid pulses
  for (let i = 0; i < gridPulses.length; i++) {
    const pulse = gridPulses[i];
    pulse.pos += pulse.speed;
    const maxBound = pulse.isHorizontal ? viewportWidth : viewportHeight;
    if (pulse.pos - pulse.length > maxBound) {
      pulse.pos = -pulse.length;
      pulse.isHorizontal = Math.random() > 0.5;
      const bound = pulse.isHorizontal ? viewportHeight : viewportWidth;
      pulse.coord = Math.floor(Math.random() * bound / GRID_SIZE) * GRID_SIZE;
      pulse.speed = 0.5 + Math.random() * 0.8;
      pulse.alpha = 0.15 + Math.random() * 0.15;
    }
  }
}

function renderFrame() {
  if (!context) return;
  context.clearRect(0, 0, viewportWidth, viewportHeight);

  // 1. Render Interactive Pointer Grid Node Illuminations
  if (pointer.active) {
    const pX = pointer.x;
    const pY = pointer.y;
    const glowRadius = 180;
    const minGridX = Math.max(0, Math.floor((pX - glowRadius) / GRID_SIZE) * GRID_SIZE);
    const maxGridX = Math.min(viewportWidth, Math.ceil((pX + glowRadius) / GRID_SIZE) * GRID_SIZE);
    const minGridY = Math.max(0, Math.floor((pY - glowRadius) / GRID_SIZE) * GRID_SIZE);
    const maxGridY = Math.min(viewportHeight, Math.ceil((pY + glowRadius) / GRID_SIZE) * GRID_SIZE);

    for (let gx = minGridX; gx <= maxGridX; gx += GRID_SIZE) {
      for (let gy = minGridY; gy <= maxGridY; gy += GRID_SIZE) {
        const dist = Math.hypot(gx - pX, gy - pY);
        if (dist < glowRadius) {
          const intensity = 1 - dist / glowRadius;
          const alpha = intensity * intensity * 0.35;
          context.beginPath();
          context.arc(gx, gy, 1.6, 0, Math.PI * 2);
          context.fillStyle = `rgba(37, 99, 235, ${alpha})`;
          context.fill();
        }
      }
    }
  }

  // 2. Render Autonomous Grid Pulses (agent pipeline telemetry)
  for (let i = 0; i < gridPulses.length; i++) {
    const pulse = gridPulses[i];
    context.save();
    context.lineWidth = 1.2;
    context.beginPath();

    if (pulse.isHorizontal) {
      const startX = Math.max(0, pulse.pos - pulse.length);
      const endX = Math.min(viewportWidth, pulse.pos);
      if (startX < endX) {
        const gradient = context.createLinearGradient(startX, pulse.coord, endX, pulse.coord);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0)');
        gradient.addColorStop(0.8, `rgba(56, 189, 248, ${pulse.alpha})`);
        gradient.addColorStop(1, `rgba(37, 99, 235, ${pulse.alpha * 1.5})`);
        context.strokeStyle = gradient;
        context.moveTo(startX, pulse.coord);
        context.lineTo(endX, pulse.coord);
        context.stroke();
      }
    } else {
      const startY = Math.max(0, pulse.pos - pulse.length);
      const endY = Math.min(viewportHeight, pulse.pos);
      if (startY < endY) {
        const gradient = context.createLinearGradient(pulse.coord, startY, pulse.coord, endY);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0)');
        gradient.addColorStop(0.8, `rgba(56, 189, 248, ${pulse.alpha})`);
        gradient.addColorStop(1, `rgba(37, 99, 235, ${pulse.alpha * 1.5})`);
        context.strokeStyle = gradient;
        context.moveTo(pulse.coord, startY);
        context.lineTo(pulse.coord, endY);
        context.stroke();
      }
    }
    context.restore();
  }

  // 3. Render Subtle Procedural Particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const pulseAlpha = p.baseAlpha + Math.sin(p.phase) * 0.05;
    context.beginPath();
    context.arc(p.x, p.y, p.radius, 0, Math.PI * 2);

    if (p.isAccent) {
      context.fillStyle = `rgba(37, 99, 235, ${Math.max(0.04, pulseAlpha * 1.3)})`;
    } else {
      context.fillStyle = `rgba(15, 23, 42, ${Math.max(0.03, pulseAlpha * 0.85)})`;
    }
    context.fill();
  }
}

function renderStaticBackground() {
  if (!context) return;
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  // Elegant, quiet static dot matrix for reduced motion
  for (let x = GRID_SIZE; x < viewportWidth; x += GRID_SIZE * 2) {
    for (let y = GRID_SIZE; y < viewportHeight; y += GRID_SIZE * 2) {
      context.beginPath();
      context.arc(x, y, 1, 0, Math.PI * 2);
      context.fillStyle = 'rgba(15, 23, 42, 0.06)';
      context.fill();
    }
  }
}

function animate() {
  if (prefersReducedMotion) return;
  updateSimulation();
  renderFrame();
  animationFrame = window.requestAnimationFrame(animate);
}

function startAnimation() {
  if (animationFrame !== undefined || document.hidden || prefersReducedMotion) return;
  animationFrame = window.requestAnimationFrame(animate);
}

function stopAnimation() {
  if (animationFrame === undefined) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
}

function onPointerMove(event) {
  pointer.targetX = event.clientX;
  pointer.targetY = event.clientY;
  pointer.active = true;
}

function onPointerLeave() {
  pointer.active = false;
  pointer.targetX = -1000;
  pointer.targetY = -1000;
}

function onScroll() {
  scrollY = window.scrollY || window.pageYOffset || 0;
}

function onVisibilityChange() {
  if (document.hidden) stopAnimation();
  else startAnimation();
}

onMounted(async () => {
  mounted = true;
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  enabled.value = true;
  await nextTick();
  if (!mounted) return;

  context = canvas.value?.getContext('2d', { alpha: true });
  if (!context) return;

  resize();
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('mouseleave', onPointerLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (!prefersReducedMotion) {
    startAnimation();
  }
});

onUnmounted(() => {
  mounted = false;
  stopAnimation();
  window.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('mouseleave', onPointerLeave);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <canvas v-if="enabled" ref="canvas" class="procedural-field" aria-hidden="true"></canvas>
</template>

<style scoped>
.procedural-field {
  position: fixed;
  z-index: 0;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  contain: strict;
}
</style>
