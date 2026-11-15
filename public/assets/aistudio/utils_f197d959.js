const numberFormatCache = new Map();

function numberFormatter(min, max) {
  const key = `${min}:${max}`;
  if (!numberFormatCache.has(key)) {
    numberFormatCache.set(
      key,
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: min,
        maximumFractionDigits: max,
      }),
    );
  }
  return numberFormatCache.get(key);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function fmtSigned(value, decimals = 2) {
  if (!Number.isFinite(value)) return "—";
  const text = numberFormatter(decimals, decimals).format(Math.abs(value));
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

export function fmtP(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 0.0001) return "< 0.0001";
  return value.toFixed(4);
}

export function fmtCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const ns = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${ns} · ${ew}`;
}

export function fmtBounds(bounds) {
  if (!bounds) return "";
  const latA = `${Math.abs(bounds.lat_min).toFixed(0)}°${bounds.lat_min >= 0 ? "N" : "S"}`;
  const latB = `${Math.abs(bounds.lat_max).toFixed(0)}°${bounds.lat_max >= 0 ? "N" : "S"}`;
  const lonA = `${Math.abs(bounds.lon_min).toFixed(0)}°${bounds.lon_min >= 0 ? "E" : "W"}`;
  const lonB = `${Math.abs(bounds.lon_max).toFixed(0)}°${bounds.lon_max >= 0 ? "E" : "W"}`;
  return `${latA}–${latB} · ${lonA}–${lonB}`;
}

export function foldSearch(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function debounce(fn, wait = 120) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function cellKey(lat, lon) {
  return `${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;
}

export function nearestCell(cells, lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  for (const cell of cells) {
    let dLon = Math.abs(cell.lon - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const dLat = cell.lat - lat;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}

export function niceDecimals(domain) {
  if (domain >= 10) return 0;
  if (domain >= 1) return 1;
  return 2;
}

export function formatDomainTick(value, variable) {
  return fmtSigned(value, variable.tickDecimals);
}

export function trendWord(slope, variable) {
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) return "no measurable change";
  return slope > 0 ? variable.increase : variable.decrease;
}

export function capitalise(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
