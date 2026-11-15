const FINE_POINTER = window.matchMedia("(pointer: fine)");
const HOVER = window.matchMedia("(hover: hover)");
const WIDE = window.matchMedia("(min-width: 961px)");
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

export function initDepth() {
  const root = document.documentElement;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let frame = 0;

  function enabled() {
    return FINE_POINTER.matches && HOVER.matches && WIDE.matches && !REDUCED_MOTION.matches;
  }

  function write() {
    root.style.setProperty("--scene-x", x.toFixed(4));
    root.style.setProperty("--scene-y", y.toFixed(4));
  }

  function writeScroll() {
    const span = Math.max(1, window.innerHeight * 1.5);
    root.style.setProperty("--scene-scroll", Math.min(1, window.scrollY / span).toFixed(4));
  }

  function settle() {
    cancelAnimationFrame(frame);
    frame = 0;
    targetX = 0;
    targetY = 0;
    x = 0;
    y = 0;
    write();
  }

  function tick() {
    x += (targetX - x) * 0.085;
    y += (targetY - y) * 0.085;
    write();
    if (Math.abs(targetX - x) < 0.001 && Math.abs(targetY - y) < 0.001) {
      x = targetX;
      y = targetY;
      write();
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    if (!enabled()) return;
    targetX = (event.clientX / window.innerWidth - 0.5) * 2;
    targetY = (event.clientY / window.innerHeight - 0.5) * 2;
    schedule();
  }

  function onPointerLeave() {
    if (!enabled() || (!targetX && !targetY)) return;
    targetX = 0;
    targetY = 0;
    schedule();
  }

  function syncMode() {
    if (!enabled()) {
      settle();
      root.classList.remove("cursor-on");
    }
  }

  function setupCursorGlow() {
    const glow = document.querySelector(".cursor-glow");
    if (!glow) return;
    window.addEventListener(
      "pointermove",
      (event) => {
        if (!enabled()) return;
        root.classList.add("cursor-on");
        glow.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      },
      { passive: true },
    );
  }

  function setupReveals() {
    const items = document.querySelectorAll(".reveal");
    for (const item of items) item.classList.add("is-in");
    root.classList.remove("reveal-on");
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("scroll", writeScroll, { passive: true });
  document.addEventListener("pointerleave", onPointerLeave, { passive: true });
  window.addEventListener("blur", onPointerLeave);
  for (const query of [FINE_POINTER, HOVER, WIDE, REDUCED_MOTION]) query.addEventListener("change", syncMode);

  setupCursorGlow();
  setupReveals();
  write();
  writeScroll();
}
