// Live Earth data: Open-Meteo current conditions and NASA GIBS imagery.
// Both are fetched lazily (only when the visitor turns a live mode on) and
// every value shown is labelled with its source and fetch time in the UI.

import { GRID_COLUMNS, GRID_ROWS, cellIndex } from "./heat.js";

export const LIVE = {
  domain: 40,
  unit: "°C",
  title: "Live temperature",
  period: "now",
  direction: "Blue = below freezing · red = above",
  source: "Open-Meteo",
};

const BATCH = 200;
const CONCURRENCY = 2;
const CACHE_KEY = "tt-live-v1";
const CACHE_MINUTES = 10;
// The free Open-Meteo tier meters every coordinate, and the full 5° grid is
// 2592 of them — one live pass would blow the per-minute allowance. Sampling
// a 10° × 15° sub-grid costs 432 and still covers every cell by nearest
// observation, so the veil stays complete without the rate limit.
const ROW_STRIDE = 2;
const COL_STRIDE = 3;
const SAMPLE_ROW_MAX = GRID_ROWS - 1 - ((GRID_ROWS - 1) % ROW_STRIDE);

function gridRowCol(cell) {
  const index = cellIndex(cell.lat, cell.lon);
  return { row: Math.floor(index / GRID_COLUMNS), col: index % GRID_COLUMNS };
}

function samplePoints(cells) {
  return cells.filter(({ lat, lon }) => {
    const { row, col } = gridRowCol({ lat, lon });
    return row % ROW_STRIDE === 0 && col % COL_STRIDE === 0;
  });
}

function nearestObserved(row, col, observed) {
  const sampleRow = Math.min(SAMPLE_ROW_MAX, Math.round(row / ROW_STRIDE) * ROW_STRIDE);
  const sampleCol = (Math.round(col / COL_STRIDE) * COL_STRIDE) % GRID_COLUMNS;
  return observed.get(`${sampleRow}:${sampleCol}`) ?? null;
}

async function fetchBatch(cells) {
  const params = new URLSearchParams();
  for (const cell of cells) {
    params.append("latitude", cell.lat.toFixed(2));
    params.append("longitude", cell.lon.toFixed(2));
  }
  params.set("current", "temperature_2m");
  params.set("timezone", "UTC");
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(url);
    } catch {
      return { error: "Open-Meteo could not be reached" };
    }
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    if (!response.ok) return { error: `Open-Meteo HTTP ${response.status}` };
    const json = await response.json();
    const list = Array.isArray(json) ? json : [json];
    return { values: list.map((item) => item?.current?.temperature_2m ?? null) };
  }
  return { error: "Open-Meteo rate limit (HTTP 429)" };
}

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

function readCache(cellCount) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.fetchedAt || !Array.isArray(cached.values)) return null;
    if (cached.values.length !== cellCount) return null;
    if (Date.now() - Date.parse(cached.fetchedAt) > CACHE_MINUTES * 60 * 1000) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * Current 2 m air temperature for every cell, aligned to the input order.
 * Cached in sessionStorage for CACHE_MINUTES so revisits stay cheap.
 */
export async function fetchLiveTemperatures(cells, { force = false } = {}) {
  if (!force) {
    const cached = readCache(cells.length);
    if (cached) return { values: cached.values, fetchedAt: cached.fetchedAt, cached: true };
  }

  const samples = samplePoints(cells);
  const batches = [];
  for (let i = 0; i < samples.length; i += BATCH) batches.push(samples.slice(i, i + BATCH));

  const settled = await runPool(
    batches.map((batch) => () => fetchBatch(batch)),
    CONCURRENCY,
  );

  // Observed temperatures keyed by their grid position, so any cell can adopt
  // the nearest one and a failed batch only leaves a gap rather than aborting.
  const observed = new Map();
  let firstError = null;
  settled.forEach((result, i) => {
    if (result.error) {
      if (!firstError) firstError = result.error;
      return;
    }
    batches[i].forEach((cell, j) => {
      const value = result.values[j];
      if (!Number.isFinite(value)) return;
      const { row, col } = gridRowCol(cell);
      observed.set(`${row}:${col}`, value);
    });
  });

  if (!observed.size) throw new Error(firstError || "Open-Meteo returned no temperatures");

  const values = cells.map((cell) => {
    const { row, col } = gridRowCol(cell);
    return nearestObserved(row, col, observed);
  });
  const coverage = observed.size / samples.length;

  const fetchedAt = new Date().toISOString();
  // Only cache a complete pass; a partial one should refresh on the next try.
  if (coverage === 1) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, values }));
    } catch {
      // Private browsing or a full quota: live data still works, just uncached.
    }
  }
  return { values, fetchedAt, cached: false, coverage, partial: Boolean(firstError) };
}

/** Map keyed by the fixed 5° grid index, for globe veil lookups. */
export function indexLiveValues(cells, values) {
  const map = new Map();
  cells.forEach((cell, i) => {
    const value = values[i];
    if (Number.isFinite(value)) map.set(cellIndex(cell.lat, cell.lon), value);
  });
  return map;
}

const GIBS_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";

export function gibsImageUrl(date) {
  return (
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}` +
    `/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  );
}

function utcDay(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function gibsDateAvailable(date) {
  const probe = gibsImageUrl(date).replace("{z}", "2").replace("{y}", "1").replace("{x}", "1");
  try {
    const response = await fetch(probe, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Newest GIBS true-color date that actually serves tiles, or null. */
export async function resolveGibsDate() {
  for (const offset of [1, 2, 3]) {
    const date = utcDay(offset);
    if (await gibsDateAvailable(date)) return date;
  }
  return null;
}
