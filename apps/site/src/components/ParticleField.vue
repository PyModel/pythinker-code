<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const canvas = ref(null);
const enabled = ref(false);

let gl = null;
let ctx2d = null;
let animationFrame = null;
let program = null;
let buffer = null;
let uniformLocations = {};
let startTime = 0;
let viewportWidth = 0;
let viewportHeight = 0;
let mounted = false;
let isWebGL = false;

// 2D Canvas fallback dots state
let fallbackDots = [];

const vsSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fsSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_dpr;

  // High quality pseudo-random hashes
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash22(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec2 st = gl_FragCoord.xy;
    vec2 center = u_resolution * 0.5;

    // Uniform grid spacing (~28 physical px scaled by DPR for consistent density)
    float gridPitch = 26.0 * u_dpr;
    float dotRadius = (6.0 * 0.5) * u_dpr; // 6px dot diameter

    // Grid cell identification
    vec2 cellIndex = floor(st / gridPitch);
    vec2 cellCenter = (cellIndex + 0.5) * gridPitch;

    // Distance to dot center in current cell
    vec2 delta = st - cellCenter;
    float distToDot = length(delta);

    // Sharp dot shape with subtle sub-pixel anti-aliasing
    float dotMask = 1.0 - smoothstep(dotRadius - 0.75 * u_dpr, dotRadius + 0.75 * u_dpr, distToDot);

    if (dotMask <= 0.001) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Distance from viewport center (normalized 0.0 at center to 1.0+ at corners)
    float maxDim = length(center);
    float distFromCenter = length(cellCenter - center) / maxDim;

    // Random seeds per cell for organic timing & opacity variation
    float cellHash = hash21(cellIndex);
    float cellHash2 = hash22(cellIndex);

    // Subtle, technical, randomized base opacity (monochrome white/gray)
    float baseOpacity = 0.12 + 0.42 * cellHash;

    // Organic timing offset per dot for non-uniform wave front
    float organicDist = distFromCenter + (cellHash - 0.5) * 0.26;

    // Layer 1: Forward radial reveal wave (expanding outward from center)
    float speed1 = 0.22;
    float cycle1 = 7.0;
    float t1 = mod(u_time * speed1, cycle1);
    float waveProgress1 = (t1 / cycle1) * 2.2 - 0.2;
    float forwardWave = smoothstep(waveProgress1 - 0.55, waveProgress1, organicDist)
                      * (1.0 - smoothstep(waveProgress1, waveProgress1 + 0.55, organicDist));

    // Layer 2: Reverse exit wave (disappearing toward outward regions with different speed)
    float speed2 = 0.16;
    float cycle2 = 8.5;
    float t2 = mod(u_time * speed2 + 3.2, cycle2);
    float waveProgress2 = (t2 / cycle2) * 2.2 - 0.2;
    float reverseWave = smoothstep(waveProgress2 - 0.65, waveProgress2, organicDist)
                      * (1.0 - smoothstep(waveProgress2, waveProgress2 + 0.65, organicDist));

    // Subtle atmospheric baseline presence
    float ambientPresence = 0.06 * (0.5 + 0.5 * sin(u_time * 0.4 + cellHash2 * 6.2831));

    // Combined animated intensity
    float waveAlpha = clamp(forwardWave * 0.85 + reverseWave * 0.60 + ambientPresence, 0.0, 1.0);
    float dotAlpha = baseOpacity * waveAlpha * dotMask;

    // Atmospheric Masking (pure black base):
    // 1. Strong black radial gradient centered on viewport:
    //    keeps center dark, allows dot texture to emerge away from center
    float centerMask = smoothstep(0.08, 0.50, distFromCenter);

    // 2. Top-to-bottom black gradient covering roughly upper third (fades upper area to pure black)
    float yNorm = st.y / u_resolution.y; // 0.0 at bottom, 1.0 at top in WebGL
    float topMask = smoothstep(0.96, 0.62, yNorm);
    float bottomMask = smoothstep(0.02, 0.15, yNorm);

    // Final monochrome white dot on pure black canvas
    float finalAlpha = dotAlpha * centerMask * topMask * bottomMask;

    gl_FragColor = vec4(vec3(finalAlpha), 1.0);
  }
`;

function createShader(glCtx, type, source) {
  const shader = glCtx.createShader(type);
  glCtx.shaderSource(shader, source);
  glCtx.compileShader(shader);
  if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
    console.warn('WebGL shader compile error:', glCtx.getShaderInfoLog(shader));
    glCtx.deleteShader(shader);
    return null;
  }
  return shader;
}

function initWebGL() {
  const cvs = canvas.value;
  if (!cvs) return false;

  gl = cvs.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false })
    || cvs.getContext('experimental-webgl');
  if (!gl) return false;

  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return false;

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('WebGL program link error:', gl.getProgramInfoLog(program));
    return false;
  }

  gl.useProgram(program);

  // Full screen quad (-1 to 1)
  const vertices = new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
    -1.0,  1.0,
     1.0, -1.0,
     1.0,  1.0,
  ]);

  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  uniformLocations = {
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    time: gl.getUniformLocation(program, 'u_time'),
    dpr: gl.getUniformLocation(program, 'u_dpr'),
  };

  return true;
}

function init2DFallback() {
  const cvs = canvas.value;
  if (!cvs) return;
  ctx2d = cvs.getContext('2d');
  createFallbackGrid();
}

function createFallbackGrid() {
  const gridPitch = 26;
  const cols = Math.ceil(viewportWidth / gridPitch);
  const rows = Math.ceil(viewportHeight / gridPitch);
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  const maxDim = Math.hypot(cx, cy);

  fallbackDots = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = (c + 0.5) * gridPitch;
      const y = (r + 0.5) * gridPitch;
      const dist = Math.hypot(x - cx, y - cy) / maxDim;
      const hash = Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1;
      fallbackDots.push({
        x,
        y,
        dist,
        hash,
        baseAlpha: 0.12 + 0.42 * hash,
        noiseDist: dist + (hash - 0.5) * 0.26,
      });
    }
  }
}

function resize() {
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (canvas.value) {
    canvas.value.width = Math.round(viewportWidth * dpr);
    canvas.value.height = Math.round(viewportHeight * dpr);
  }

  if (isWebGL && gl && program) {
    gl.viewport(0, 0, canvas.value.width, canvas.value.height);
    gl.useProgram(program);
    gl.uniform2f(uniformLocations.resolution, canvas.value.width, canvas.value.height);
    gl.uniform1f(uniformLocations.dpr, dpr);
  } else if (ctx2d) {
    createFallbackGrid();
  }
}

function render(timestamp) {
  const timeSec = (timestamp - startTime) * 0.001;

  if (isWebGL && gl && program) {
    gl.useProgram(program);
    gl.uniform1f(uniformLocations.time, timeSec);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  } else if (ctx2d) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, viewportWidth, viewportHeight);

    const speed1 = 0.22;
    const cycle1 = 7.0;
    const t1 = (timeSec * speed1) % cycle1;
    const waveProgress1 = (t1 / cycle1) * 2.2 - 0.2;

    const speed2 = 0.16;
    const cycle2 = 8.5;
    const t2 = (timeSec * speed2 + 3.2) % cycle2;
    const waveProgress2 = (t2 / cycle2) * 2.2 - 0.2;

    for (const dot of fallbackDots) {
      const d1 = dot.noiseDist;
      let fw = 0;
      if (d1 >= waveProgress1 - 0.55 && d1 <= waveProgress1 + 0.55) {
        fw = Math.sin(((d1 - (waveProgress1 - 0.55)) / 1.1) * Math.PI);
      }
      let rw = 0;
      if (d1 >= waveProgress2 - 0.65 && d1 <= waveProgress2 + 0.65) {
        rw = Math.sin(((d1 - (waveProgress2 - 0.65)) / 1.3) * Math.PI);
      }
      const anim = Math.max(0, Math.min(1, fw * 0.85 + rw * 0.60 + 0.05));
      const centerMask = Math.max(0, Math.min(1, (dot.dist - 0.08) / 0.42));
      const yNorm = 1.0 - dot.y / viewportHeight;
      const topMask = Math.max(0, Math.min(1, (yNorm - 0.62) / 0.34));
      const alpha = dot.baseAlpha * anim * centerMask * (1.0 - topMask * 0.85);

      if (alpha > 0.01) {
        ctx2d.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx2d.beginPath();
        ctx2d.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
  }

  animationFrame = window.requestAnimationFrame(render);
}

function startAnimation() {
  if (animationFrame !== null || document.hidden) return;
  startTime = performance.now();
  animationFrame = window.requestAnimationFrame(render);
}

function stopAnimation() {
  if (animationFrame === null) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function onVisibilityChange() {
  if (document.hidden) stopAnimation();
  else startAnimation();
}

onMounted(async () => {
  mounted = true;
  enabled.value = true;
  await nextTick();
  if (!mounted) return;

  isWebGL = initWebGL();
  if (!isWebGL) {
    init2DFallback();
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Render single static frame for reduced motion
    render(performance.now());
    stopAnimation();
  } else {
    startAnimation();
  }
});

onUnmounted(() => {
  mounted = false;
  stopAnimation();
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (gl && program) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  }
});
</script>

<template>
  <div class="dot-matrix-bg-container" aria-hidden="true">
    <canvas v-if="enabled" ref="canvas" class="dot-matrix-canvas"></canvas>
    <!-- Atmospheric Masking Layers -->
    <div class="atmospheric-mask atmospheric-mask--radial"></div>
    <div class="atmospheric-mask atmospheric-mask--gradient"></div>
  </div>
</template>

<style scoped>
.dot-matrix-bg-container {
  position: fixed;
  z-index: 0;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background-color: #000000;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
}

.dot-matrix-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* Atmospheric masking over particles */
.atmospheric-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 1. Strong black radial gradient keeping center dark */
.atmospheric-mask--radial {
  background: radial-gradient(
    circle at 50% 50%,
    rgba(0, 0, 0, 0.94) 0%,
    rgba(0, 0, 0, 0.70) 30%,
    rgba(0, 0, 0, 0.20) 65%,
    rgba(0, 0, 0, 0.85) 100%
  );
}

/* 2. Top-to-bottom black gradient covering upper third */
.atmospheric-mask--gradient {
  background: linear-gradient(
    180deg,
    #000000 0%,
    rgba(0, 0, 0, 0.90) 18%,
    rgba(0, 0, 0, 0.0) 38%,
    rgba(0, 0, 0, 0.0) 75%,
    rgba(0, 0, 0, 0.95) 100%
  );
}
</style>
