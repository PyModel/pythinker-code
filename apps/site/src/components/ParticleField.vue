<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const canvas = ref(null);
const enabled = ref(false);

let context;
let animationFrame;
let particles = [];
let viewportWidth = 0;
let viewportHeight = 0;
let mounted = false;

const pointer = { x: Infinity, y: Infinity };
const pointerRadius = 120;

function createParticles() {
  const count = Math.max(40, Math.min(90, Math.round((viewportWidth * viewportHeight) / 16000)));
  particles = Array.from({ length: count }, () => {
    const homeX = Math.random() * viewportWidth;
    const homeY = Math.random() * viewportHeight;
    return {
      homeX,
      homeY,
      x: homeX,
      y: homeY,
      velocityX: 0,
      velocityY: 0,
      driftX: (Math.random() - 0.5) * 0.08,
      driftY: (Math.random() - 0.5) * 0.08,
      radius: 0.8 + Math.random(),
      color: Math.random() < 0.06 ? 'rgba(43, 137, 255, 0.35)' : 'rgba(17, 17, 19, 0.22)',
    };
  });
}

function resize() {
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  context.setTransform(1, 0, 0, 1, 0, 0);
  canvas.value.width = Math.round(viewportWidth * pixelRatio);
  canvas.value.height = Math.round(viewportHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  createParticles();
}

function moveParticles() {
  for (const particle of particles) {
    particle.homeX += particle.driftX;
    particle.homeY += particle.driftY;
    if (particle.homeX < 0 || particle.homeX > viewportWidth) particle.driftX *= -1;
    if (particle.homeY < 0 || particle.homeY > viewportHeight) particle.driftY *= -1;

    const deltaX = particle.x - pointer.x;
    const deltaY = particle.y - pointer.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance < pointerRadius) {
      const force = ((pointerRadius - distance) / pointerRadius) * 0.8;
      const safeDistance = Math.max(distance, 0.01);
      particle.velocityX += (deltaX / safeDistance) * force;
      particle.velocityY += (deltaY / safeDistance) * force;
    } else {
      particle.velocityX += (particle.homeX - particle.x) * 0.008;
      particle.velocityY += (particle.homeY - particle.y) * 0.008;
    }

    particle.velocityX *= 0.92;
    particle.velocityY *= 0.92;
    particle.x += particle.velocityX;
    particle.y += particle.velocityY;
  }
}

function drawParticles() {
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  moveParticles();

  for (const particle of particles) {
    context.beginPath();
    context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    context.fillStyle = particle.color;
    context.fill();
  }
}

function animate() {
  drawParticles();
  animationFrame = window.requestAnimationFrame(animate);
}

function startAnimation() {
  if (animationFrame !== undefined || document.hidden) return;
  animationFrame = window.requestAnimationFrame(animate);
}

function stopAnimation() {
  if (animationFrame === undefined) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
}

function onPointerMove(event) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}

function onVisibilityChange() {
  if (document.hidden) stopAnimation();
  else startAnimation();
}

onMounted(async () => {
  mounted = true;
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || !window.matchMedia('(pointer: fine)').matches
  ) return;

  enabled.value = true;
  await nextTick();
  if (!mounted) return;

  context = canvas.value?.getContext('2d');
  if (!context) return;

  resize();
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  startAnimation();
});

onUnmounted(() => {
  mounted = false;
  stopAnimation();
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <canvas v-if="enabled" ref="canvas" class="particle-field" aria-hidden="true"></canvas>
</template>

<style scoped>
.particle-field {
  position: fixed;
  z-index: -1;
  inset: 0;
  pointer-events: none;
}
</style>
