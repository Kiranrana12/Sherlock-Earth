/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
// Living space backdrop: a slow depth-drifted starfield plus dust, both parallaxed
// against the pointer. CSS nebula layers sit underneath and drift on their own.

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN_Z = 0.34;

const FALLBACK_PALETTE = {
  bright: "#EEF2FA",
  dim: "#A3AECB",
  rock: "#8996B3",
  alpha: 1,
  bokeh: ["rgba(46,230,197,.5)", "rgba(139,124,246,.5)", "rgba(255,180,84,.42)", "rgba(255,107,107,.4)"],
};

export function initSpace() {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;

  const context = canvas.getContext("2d", { alpha: true });
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    stars: [],
    dust: [],
    bokeh: [],
    pointerX: 0,
    pointerY: 0,
    targetX: 0,
    targetY: 0,
    palette: FALLBACK_PALETTE,
  };
  let frame = 0;
  let start = performance.now();
  let elapsed = 0;
  let last = 0;

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const alpha = Number.parseFloat(read("--star-alpha", "1"));
    state.palette = {
      bright: read("--star-bright", FALLBACK_PALETTE.bright),
      dim: read("--star-dim", FALLBACK_PALETTE.dim),
      rock: read("--star-rock", FALLBACK_PALETTE.rock),
      alpha: Number.isFinite(alpha) ? alpha : 1,
      bokeh: [
        read("--bokeh-one", FALLBACK_PALETTE.bokeh[0]),
        read("--bokeh-two", FALLBACK_PALETTE.bokeh[1]),
        read("--bokeh-three", FALLBACK_PALETTE.bokeh[2]),
        read("--bokeh-four", FALLBACK_PALETTE.bokeh[3]),
      ],
    };
  }

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    build();
  }

  function makeStar(z) {
    return {
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: z ?? MIN_Z + Math.random() * (1 - MIN_Z),
      size: 0.5 + Math.random() * 1.1,
      alpha: 0.2 + Math.random() * 0.62,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.4 + Math.random() * 1.1,
      speed: 0.7 + Math.random() * 0.8,
    };
  }

  function build() {
    const area = state.width * state.height;
    const starCount = Math.min(380, Math.max(150, Math.round(area / 4600)));
    const dustCount = Math.min(30, Math.max(12, Math.round(area / 82000)));
    state.stars = Array.from({ length: starCount }, () => makeStar());
    state.dust = Array.from({ length: dustCount }, () => ({
      x: Math.random() * state.width,
      y: Math.random() * state.height,
      radius: 0.8 + Math.random() * 1.7,
      speed: 0.012 + Math.random() * 0.03,
      depth: 0.35 + Math.random() * 0.65,
      alpha: 0.16 + Math.random() * 0.3,
    }));
    const bokehCount = Math.min(22, Math.max(9, Math.round(area / 92000)));
    state.bokeh = Array.from({ length: bokehCount }, () => ({
      x: Math.random() * state.width,
      y: Math.random() * state.height,
      radius: 22 + Math.random() * 64,
      color: Math.floor(Math.random() * 4),
      alpha: 0.35 + Math.random() * 0.5,
      vx: (Math.random() - 0.5) * 7,
      vy: (Math.random() - 0.5) * 5,
      phase: Math.random() * Math.PI * 2,
      wobble: 0.25 + Math.random() * 0.5,
      depth: 0.3 + Math.random() * 0.7,
    }));
    if (REDUCED_MOTION) draw(0, 0, 0);
  }

  function project(star, px, py) {
    const k = 1 / star.z;
    return {
      x: state.width / 2 + star.x * (state.width / 2) * k * 0.62 + px * (k - 1),
      y: state.height / 2 + star.y * (state.height / 2) * k * 0.62 + py * (k - 1),
      k,
    };
  }

  function draw(time, elapsedMs, dt) {
    const palette = state.palette;
    const { width, height } = state;
    context.clearRect(0, 0, width, height);
    const px = state.pointerX * 10;
    const py = state.pointerY * 8;

    for (const cloud of state.bokeh) {
      if (!REDUCED_MOTION) {
        cloud.x += (cloud.vx + Math.sin(time * 0.00022 * cloud.wobble + cloud.phase) * 4) * dt;
        cloud.y += (cloud.vy + Math.cos(time * 0.00018 * cloud.wobble + cloud.phase) * 3) * dt;
      }
      const margin = cloud.radius * 2;
      if (cloud.x < -margin) cloud.x = width + margin;
      if (cloud.x > width + margin) cloud.x = -margin;
      if (cloud.y < -margin) cloud.y = height + margin;
      if (cloud.y > height + margin) cloud.y = -margin;
      const x = cloud.x + px * cloud.depth * 1.6;
      const y = cloud.y + py * cloud.depth * 1.4;
      const pulse = REDUCED_MOTION ? 1 : 0.82 + Math.sin(time * 0.0003 * cloud.wobble + cloud.phase) * 0.18;
      const radius = cloud.radius * pulse;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      const tint = palette.bokeh[cloud.color];
      gradient.addColorStop(0, tint);
      gradient.addColorStop(1, /,\s*[\d.]+\)$/.test(tint) ? tint.replace(/,\s*[\d.]+\)$/, ", 0)") : "transparent");
      context.globalAlpha = cloud.alpha * palette.alpha * 0.55;
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    for (const star of state.stars) {
      if (!REDUCED_MOTION) {
        star.z -= dt * 0.02 * star.speed;
        if (star.z < MIN_Z) Object.assign(star, makeStar(1));
      }
      const { x, y, k } = project(star, px, py);
      if (x < -30 || x > width + 30 || y < -30 || y > height + 30) {
        if (!REDUCED_MOTION) Object.assign(star, makeStar());
        continue;
      }
      const twinkle = REDUCED_MOTION ? 1 : 0.72 + Math.sin(time * 0.00035 * star.twinkle + star.phase) * 0.28;
      const fadeIn = Math.min(1, (1 - star.z) / 0.1 + 0.25);
      context.globalAlpha = star.alpha * twinkle * fadeIn * palette.alpha;
      context.fillStyle = star.z < 0.62 ? palette.bright : palette.dim;
      context.beginPath();
      context.arc(x, y, star.size * (0.55 + k * 0.45), 0, Math.PI * 2);
      context.fill();
    }

    for (const mote of state.dust) {
      const x = (mote.x + elapsedMs * 0.0016 * mote.speed * 60 + px * mote.depth) % (width + 24);
      const y = (mote.y + elapsedMs * 0.0008 * mote.speed * 60 + py * mote.depth) % height;
      context.globalAlpha = mote.alpha * palette.alpha;
      context.fillStyle = palette.rock;
      context.beginPath();
      context.ellipse(x, y, mote.radius * 1.9, mote.radius * 0.9, -0.3, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function stopLoop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function startLoop() {
    stopLoop();
    start = performance.now() - elapsed;
    last = performance.now();
    frame = requestAnimationFrame(animate);
  }

  function animate(now) {
    if (document.hidden) return;
    elapsed = now - start;
    const dt = Math.min(48, now - (last || now)) / 1000;
    last = now;
    if (!REDUCED_MOTION) {
      state.pointerX += (state.targetX - state.pointerX) * 0.025;
      state.pointerY += (state.targetY - state.pointerY) * 0.025;
    }
    draw(now, elapsed, dt);
    frame = requestAnimationFrame(animate);
  }

  function onPointerMove(event) {
    if (REDUCED_MOTION) return;
    state.targetX = (event.clientX / state.width - 0.5) * 2;
    state.targetY = (event.clientY / state.height - 0.5) * 2;
  }

  function onVisibilityChange() {
    stopLoop();
    if (!document.hidden) startLoop();
  }

  function onThemeChange() {
    readPalette();
    if (REDUCED_MOTION) draw(0, elapsed, 0);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("themechange", onThemeChange);

  readPalette();
  resize();
  if (REDUCED_MOTION) draw(0, 0, 0);
  else {
    last = performance.now();
    if (!document.hidden) frame = requestAnimationFrame(animate);
  }
}
