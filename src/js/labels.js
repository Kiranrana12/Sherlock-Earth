/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
// Static place labels drawn as DOM on top of the globe.
// They follow the 3D projection, hide on the far side, and drop lower-priority
// labels when they would collide. No country boundaries are implied here.

import { clamp } from "./utils.js";

const LABELS = [
  { name: "North America", kind: "continent", lat: 47, lon: -101, priority: 30 },
  { name: "South America", kind: "continent", lat: -16, lon: -59, priority: 30 },
  { name: "Europe", kind: "continent", lat: 53, lon: 16, priority: 30 },
  { name: "Africa", kind: "continent", lat: 4, lon: 20, priority: 30 },
  { name: "Asia", kind: "continent", lat: 43, lon: 88, priority: 30 },
  { name: "Oceania", kind: "continent", lat: -25, lon: 134, priority: 30 },
  { name: "Antarctica", kind: "continent", lat: -80, lon: 20, priority: 12 },

  { name: "Pacific Ocean", kind: "ocean", lat: -8, lon: -152, priority: 24 },
  { name: "Atlantic Ocean", kind: "ocean", lat: 18, lon: -38, priority: 24 },
  { name: "Indian Ocean", kind: "ocean", lat: -18, lon: 80, priority: 24 },
  { name: "Arctic Ocean", kind: "ocean", lat: 84, lon: -40, priority: 20 },
  { name: "Southern Ocean", kind: "ocean", lat: -57, lon: 30, priority: 18 },

  { name: "Rocky Mountains", kind: "range", lat: 43, lon: -112, priority: 16 },
  { name: "Andes", kind: "range", lat: -20, lon: -70, priority: 16 },
  { name: "Himalayas", kind: "range", lat: 30, lon: 84, priority: 16 },
  { name: "Alps", kind: "range", lat: 46, lon: 10, priority: 14 },
  { name: "Urals", kind: "range", lat: 60, lon: 59, priority: 14 },
  { name: "Great Dividing Range", kind: "range", lat: -26, lon: 147, priority: 14 },

  { name: "New York", kind: "city", lat: 40.71, lon: -74.01, priority: 10 },
  { name: "São Paulo", kind: "city", lat: -23.55, lon: -46.63, priority: 10 },
  { name: "London", kind: "city", lat: 51.51, lon: -0.13, priority: 10 },
  { name: "Lagos", kind: "city", lat: 6.52, lon: 3.38, priority: 10 },
  { name: "Cairo", kind: "city", lat: 30.04, lon: 31.24, priority: 10 },
  { name: "Delhi", kind: "city", lat: 28.61, lon: 77.21, priority: 10 },
  { name: "Beijing", kind: "city", lat: 39.9, lon: 116.41, priority: 10 },
  { name: "Tokyo", kind: "city", lat: 35.68, lon: 139.69, priority: 10 },
  { name: "Sydney", kind: "city", lat: -33.87, lon: 151.21, priority: 10 },
];

export function createLabelLayer(container) {
  const items = LABELS.sort((a, b) => b.priority - a.priority).map((label) => {
    const el = document.createElement("span");
    el.className = `map-label map-label--${label.kind}`;
    el.textContent = label.name;
    container.append(el);
    return { ...label, el, width: 0, x: 0, y: 0, shown: true };
  });

  const measure = () => {
    for (const item of items) item.width = item.el.offsetWidth || 80;
  };
  measure();
  if (document.fonts?.ready) document.fonts.ready.then(measure);
  document.addEventListener("themechange", measure);

  return {
    update(globe) {
      if (container.hidden || !globe) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;

      const camera = globe.camera();
      const cam = camera.position;
      const radiusSq = globe.getGlobeRadius() ** 2;
      const placed = [];

      for (const item of items) {
        let coords;
        try {
          coords = globe.getCoords(item.lat, item.lon, 0.006);
        } catch {
          continue;
        }
        const facing = coords.x * cam.x + coords.y * cam.y + coords.z * cam.z;
        if (facing <= radiusSq * 1.002) {
          if (item.shown) item.el.style.display = "none";
          item.shown = false;
          continue;
        }

        const screen = globe.getScreenCoords(item.lat, item.lon, 0.006);
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
        if (screen.x < -60 || screen.x > width + 60 || screen.y < -20 || screen.y > height + 20) {
          if (item.shown) item.el.style.display = "none";
          item.shown = false;
          continue;
        }

        const collides = placed.some(
          (other) =>
            Math.abs(other.x - screen.x) < (other.width + item.width) / 2 + 7 &&
            Math.abs(other.y - screen.y) < 15,
        );
        if (collides) {
          if (item.shown) item.el.style.display = "none";
          item.shown = false;
          continue;
        }

        placed.push({ x: screen.x, y: screen.y, width: item.width });
        const rim = clamp((facing - radiusSq) / (radiusSq * 1.6), 0, 1);
        const opacity = 0.58 + rim * 0.42;

        if (!item.shown) item.el.style.display = "block";
        if (Math.abs(item.x - screen.x) > 0.4) item.el.style.left = `${screen.x.toFixed(1)}px`;
        if (Math.abs(item.y - screen.y) > 0.4) item.el.style.top = `${screen.y.toFixed(1)}px`;
        item.el.style.opacity = opacity.toFixed(2);
        item.x = screen.x;
        item.y = screen.y;
        item.shown = true;
      }
    },

    setVisible(visible) {
      container.hidden = !visible;
    },
  };
}
