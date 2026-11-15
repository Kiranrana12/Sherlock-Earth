// Turns the 5° cell table into one smooth equirectangular veil.
// Colors stay attached to their cells; a soft blur removes the hard grid
// edges so the sphere reads as a trend field rather than a checkerboard.

import { RD_BU, SIGNIFICANCE_LEVEL } from "./config.js";
import { clamp } from "./utils.js";

export const GRID_COLUMNS = 72;
export const GRID_ROWS = 36;

const TEX_W = 2048;
const TEX_H = 1024;
const LOW_W = 720;
const LOW_H = 360;
// Natural base: a light tint keeps the Earth's own colors readable.
// Data base: the same cells, stronger, because the base is already dark.
const ALPHA = {
  natural: { sig: [0.16, 0.58], nosig: [0.02, 0.13] },
  data: { sig: [0.12, 0.9], nosig: [0.03, 0.3] },
};
// Weak trends should stay quiet, especially over the dark base, so the
// saturated cells carry the story instead of a pale film over everything.
const FADE = { natural: 1.05, data: 1.55 };
const RING_RADIUS = 1.3;

const RGB = RD_BU.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/** Fixed grid position for a coordinate. Row 0 is the south pole edge. */
export function cellIndex(lat, lon) {
  const row = clamp(Math.floor((lat + 90) / 5), 0, GRID_ROWS - 1);
  const wrapped = ((lon + 180) % 360 + 360) % 360;
  return row * GRID_COLUMNS + Math.floor(wrapped / 5);
}

export function indexCells(cells) {
  const map = new Map();
  for (const cell of cells) map.set(cellIndex(cell.lat, cell.lon), cell);
  return map;
}

export function colorForSlope(slope, domain) {
  const t = clamp((slope + domain) / (2 * domain), 0, 1) * (RGB.length - 1);
  const i = Math.min(RGB.length - 2, Math.floor(t));
  const f = t - i;
  const a = RGB[i];
  const b = RGB[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function buildTrendCanvas(cells, variable, base = "natural") {
  const low = document.createElement("canvas");
  low.width = LOW_W;
  low.height = LOW_H;
  const lowCtx = low.getContext("2d");
  const cellW = LOW_W / GRID_COLUMNS;
  const cellH = LOW_H / GRID_ROWS;
  let sigCount = 0;

  for (const cell of cells) {
    const significant = Number(cell.p) < SIGNIFICANCE_LEVEL;
    if (significant) sigCount += 1;
    const [r, g, b] = colorForSlope(cell.slope, variable.domain);
    // Near-zero colors are nearly white; fade them out so the globe keeps its
    // earth colors instead of collecting a milky film in calm regions.
    const intensity = clamp(Math.abs(cell.slope) / variable.domain, 0, 1);
    const range = ALPHA[base] || ALPHA.natural;
    const [minAlpha, maxAlpha] = significant ? range.sig : range.nosig;
    const alpha = minAlpha + (maxAlpha - minAlpha) * intensity ** (FADE[base] || 1);
    const row = GRID_ROWS - 1 - clamp(Math.floor((cell.lat + 90) / 5), 0, GRID_ROWS - 1);
    const col = cellIndex(cell.lat, cell.lon) % GRID_COLUMNS;
    lowCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    lowCtx.fillRect(col * cellW, row * cellH, cellW, cellH);
  }

  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  if ("filter" in ctx) ctx.filter = "blur(10px)";
  ctx.drawImage(low, 0, 0, TEX_W, TEX_H);
  if ("filter" in ctx) ctx.filter = "none";

  // A dark rim under each white significance marker keeps the marker legible
  // over the pale middle of the scale.
  ctx.fillStyle = "rgba(9, 14, 27, .72)";
  for (const cell of cells) {
    if (Number(cell.p) >= SIGNIFICANCE_LEVEL) continue;
    const x = ((cell.lon + 180) / 360) * TEX_W;
    const y = ((90 - cell.lat) / 180) * TEX_H;
    ctx.beginPath();
    ctx.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  return { canvas, sigCount };
}

/**
 * Same veil, but colored by an arbitrary per-cell value (live observations).
 * `values` is keyed by the fixed grid index; there is no significance layer.
 */
export function buildLiveCanvas(cells, values, domain, base = "natural") {
  const low = document.createElement("canvas");
  low.width = LOW_W;
  low.height = LOW_H;
  const lowCtx = low.getContext("2d");
  const cellW = LOW_W / GRID_COLUMNS;
  const cellH = LOW_H / GRID_ROWS;
  let painted = 0;

  for (const cell of cells) {
    const value = values.get(cellIndex(cell.lat, cell.lon));
    if (!Number.isFinite(value)) continue;
    painted += 1;
    const [r, g, b] = colorForSlope(value, domain);
    const intensity = clamp(Math.abs(value) / domain, 0, 1);
    const range = ALPHA[base] || ALPHA.natural;
    const [minAlpha, maxAlpha] = range.sig;
    const alpha = minAlpha + (maxAlpha - minAlpha) * intensity ** (FADE[base] || 1);
    const row = GRID_ROWS - 1 - clamp(Math.floor((cell.lat + 90) / 5), 0, GRID_ROWS - 1);
    const col = cellIndex(cell.lat, cell.lon) % GRID_COLUMNS;
    lowCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    lowCtx.fillRect(col * cellW, row * cellH, cellW, cellH);
  }

  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  if ("filter" in ctx) ctx.filter = "blur(10px)";
  ctx.drawImage(low, 0, 0, TEX_W, TEX_H);
  if ("filter" in ctx) ctx.filter = "none";

  return { canvas, painted };
}
