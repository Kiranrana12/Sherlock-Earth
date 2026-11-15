// SI agent: a goal-driven tool loop, not a chat window.
// It reads a goal, plans an ordered list of tool calls over the site's own
// data (regions.json, top_trends.json, the place index, the live API) and
// executes them against the atlas, narrating every step in a visible trace.

import { SIGNIFICANCE_LEVEL, VARIABLES } from "./config.js";
import {
  loadCellLocations,
  loadPlaceCities,
  loadPlaceCountries,
  loadRegions,
  loadTopTrends,
} from "./data.js";
import { ensurePlaceSearch, searchPlaces } from "./places.js";
import { fmtP, fmtSigned } from "./utils.js";

const INDICATOR_WORDS = [
  ["temperature", [/\btemperature\b/, /\btemp\b/, /\bwarming\b/, /\bwarm(er|est)?\b/, /\bcool(ing|er|est)?\b/, /\bheat\b/, /\bhot(ter|test)?\b/, /°c/]],
  ["precipitation", [/\bprecipitation\b/, /\bprecip\b/, /\brain(fall|y|ier|iest)?\b/, /\bwet(ter|test|ting)?\b/, /\bdry(ing|er|iest)?\b/, /\bdriest\b/]],
  ["humidity", [/\bhumidity\b/, /\bhumid\b/, /\bmoist(ening|ure)?\b/, /\bvapor\b/, /\bvapour\b/]],
  ["wind", [/\bwind(s|y|ier|iest)?\b/, /\bbreeze\b/, /\bgale\b/]],
];

const REGION_ALIASES = {
  "amazon basin": [/\bamazon(\s+basin)?\b/],
  sahel: [/\bsahel\b/],
  "south asia": [/\bsouth\s+asia\b/, /\bmonsoon\s+asia\b/],
  arctic: [/\barctic\b/, /\bpolar\s+north\b/, /\bhigh\s+north\b/],
  "southeast asia": [/\bsoutheast\s+asia\b/, /\bsea\s+region\b/],
  mediterranean: [/\bmediterranean\b/],
};

const COMMAND_STOP_WORDS = new Set([
  "live", "current", "conditions", "now", "real", "time", "realtime",
  "trend", "trends", "slope", "slopes", "since", "2014", "2025", "over", "years", "year",
  "satellite", "imagery", "gibs", "true", "color", "truecolor", "natural",
  "earth", "plain", "globe", "map", "base", "data", "dark", "view", "reset",
  "clear", "start", "back", "global", "world", "planet", "average", "mean",
  "temperature", "temp", "warming", "warm", "warmest", "cooling", "cool", "coldest",
  "precipitation", "precip", "rain", "rainfall", "wetter", "wettest", "drying", "driest", "drier",
  "humidity", "humid", "moistening", "moisture", "wind", "winds", "windy", "windiest", "indicator",
  "show", "me", "the", "a", "an", "on", "to", "for", "of", "and", "in", "at", "by", "from", "with",
  "summarize", "summarise", "summary", "overview", "change", "changing", "changes",
  "what", "whats", "what's", "is", "are", "was", "were", "has", "have", "had", "do", "does", "did",
  "how", "fast", "faster", "fastest", "slow", "slower", "slowest", "high", "higher", "highest",
  "low", "lower", "lowest", "strong", "stronger", "strongest", "steep", "steeper", "steepest",
  "sharp", "sharper", "sharpest", "extreme", "big", "bigger", "biggest", "most", "least", "more", "less",
  "decreasing", "dropping", "declining", "weakening", "drying", "historical", "right",
  "much", "many", "why", "when", "where", "which", "who", "top",
  "tell", "about", "give", "get", "check", "look", "up", "explain", "describe", "analyze", "analyse",
  "report", "climate", "weather", "record", "series", "chart", "graph", "happening", "going",
  "getting", "becoming", "please", "can", "you", "could", "would", "compare", "contrast",
  "versus", "vs", "against", "between", "difference", "place", "country", "city", "region", "focus", "zoom",
]);

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function cleanText(raw) {
  return raw.trim().replace(/[?!.,;:]+$/g, "").trim();
}

function stripCommandWords(phrase) {
  const words = cleanText(phrase)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/'s\b/g, "")
    .split(/\s+/)
    .filter((w) => w && !COMMAND_STOP_WORDS.has(w));
  return words.join(" ").trim();
}

function planCompareTargets(rawGoal) {
  const cleaned = cleanText(rawGoal);
  const vsMatch = cleaned.match(
    /(?:compare|contrast|difference\s+between)?\s*([\p{L}0-9][\p{L}0-9\s'’.-]{1,36}?)\s+(?:vs\.?|versus|against|and|with)\s+([\p{L}0-9][\p{L}0-9\s'’.-]{1,36})$/iu,
  );
  if (!vsMatch) return null;

  const left = stripCommandWords(vsMatch[1]);
  const right = stripCommandWords(vsMatch[2]);
  const generic = new Set(["region", "regions", "regional", "place", "places", "biggest", "largest", "country", "countries", "city", "cities"]);
  if (!left || !right || generic.has(left) || generic.has(right)) return null;
  return { primary: left, secondary: right };
}

function planPlace(rawGoal, { skipBare = false } = {}) {
  const cleaned = cleanText(rawGoal);

  const spatialMatch = cleaned.match(
    /\b(?:in|at|over|around|near|about)\s+([\p{L}0-9][\p{L}0-9\s'’.-]{1,48})$/iu,
  );
  const match =
    spatialMatch ||
    cleaned.match(
      /\b(?:for|to|focus\s+on|zoom\s+(?:in\s+)?to|fly\s+to|go\s+to|find|search|show\s+me|show)\s+([\p{L}0-9][\p{L}0-9\s'’.-]{1,48})$/iu,
    );

  if (match) {
    const candidate = cleanText(match[1]).replace(/^the\s+/i, "");
    const stripped = stripCommandWords(candidate);
    if (stripped.length >= 2) {
      return { tool: "focus_place", args: { query: stripped } };
    }
    return null;
  }

  if (skipBare) return null;

  const bare = stripCommandWords(cleaned);
  if (bare.length >= 2) {
    return { tool: "focus_place", args: { query: bare } };
  }
  return null;
}

/** Pure planner: goal text -> ordered tool steps. No network, no DOM. */
export function planGoal(goal, { variable, liveMode = false } = {}) {
  const text = cleanText(goal).toLowerCase();
  const steps = [];

  const indicator = INDICATOR_WORDS.find(([, patterns]) => matchesAny(text, patterns))?.[0];
  const wantsLive = /\b(live|current\s+conditions|right\s+now|real[- ]?time)\b/.test(text);
  const wantsTrendMode = /\b(trends?|slopes?|since\s+2014|over\s+time|historical)\b/.test(text);
  const wantsReset = /\b(reset|clear|start\s+over|back\s+to\s+global|planet\s+earth)\b/.test(text);
  const wantsSummary = /\b(summari[sz]e|summary|overview|what\s+is\s+changing|global|world|earth)\b/.test(text);

  let baseMode = null;
  if (/\b(satellite|imagery|gibs|true[- ]?color)\b/.test(text)) baseMode = "satellite";
  else if (/\b(natural\s+earth|plain\s+globe|map\s+base)\b/.test(text)) baseMode = "natural";
  else if (/\b(data\s+base|dark\s+base)\b/.test(text)) baseMode = "data";

  const regionKey = Object.keys(REGION_ALIASES).find((name) =>
    text.includes(name) || matchesAny(text, REGION_ALIASES[name]),
  );
  const wantsContrast = /\b(contrast|compare|versus|vs|difference\s+between|against)\b/.test(text);
  const wantsExtreme = /\b(fastest|strongest|most|biggest|steepest|sharpest|extreme|warmest|coldest|wettest|driest|windiest|where\s+is|which\s+(?:place|country|city|area)|show\s+me\s+the\s+top|top\s+\d*|highest|lowest|slowest|least)\b/.test(text);
  const wantsDecrease = /\b(cooling|decreasing|dropping|declining|weakening|drying|drier|driest|least|slowest|coldest|lowest)\b/.test(text);
  const asksWhichRegion = /\bwhich\s+region\b/.test(text);

  const activeVariable = wantsLive ? "temperature" : indicator || variable;

  if (indicator && indicator !== variable && !wantsLive) {
    steps.push({ tool: "set_indicator", args: { name: indicator } });
  }

  if (wantsLive) {
    if (!liveMode) steps.push({ tool: "set_live", args: { on: true } });
  } else if (
    liveMode &&
    (wantsTrendMode || wantsReset || wantsContrast || regionKey || wantsExtreme || wantsSummary || (indicator && indicator !== "temperature"))
  ) {
    steps.push({ tool: "set_live", args: { on: false } });
  }

  if (baseMode) {
    steps.push({ tool: "set_base", args: { mode: baseMode } });
  }

  if (wantsReset) {
    steps.push({ tool: "reset_view", args: {} });
    return steps;
  }

  const placeCandidate =
    !regionKey && !wantsContrast && !wantsExtreme && !asksWhichRegion
      ? planPlace(goal, { skipBare: Boolean(baseMode || wantsLive || wantsSummary) })
      : null;

  if (wantsContrast) {
    const pair = planCompareTargets(goal);
    if (pair) {
      steps.push({ tool: "compare_places", args: pair });
    } else {
      steps.push({ tool: "region_contrast", args: {} });
    }
  } else if (regionKey) {
    steps.push({ tool: "select_region", args: { name: regionKey } });
  } else if (asksWhichRegion) {
    steps.push({ tool: "summarize", args: { variable: activeVariable } });
  } else if (wantsExtreme) {
    steps.push({ tool: "top_trend", args: { direction: wantsDecrease ? "decreases" : "increases" } });
  } else if (placeCandidate) {
    steps.push(placeCandidate);
  } else if (wantsSummary) {
    steps.push({ tool: "summarize", args: { variable: activeVariable } });
  }

  if (!steps.length) {
    steps.push({ tool: "summarize", args: { variable: activeVariable } });
  }
  return steps;
}

function formatStat(record, variable) {
  if (!record || !Number.isFinite(record.slope)) return "";
  const cfg = VARIABLES[variable];
  const sig = Number(record.p) < SIGNIFICANCE_LEVEL ? "significant" : "not significant";
  return `${cfg.label}: ${fmtSigned(record.slope, cfg.decimals)} ${cfg.units} (p = ${fmtP(record.p)}, ${sig})`;
}

export function createSiAgent({ trace, actions }) {
  let runToken = 0;

  function log(id, step, state, detail) {
    trace?.({ id, tool: step.tool, state, detail });
  }

  async function findPlace(query) {
    await ensurePlaceSearch();
    const cleaned = cleanText(query);
    let [hit] = searchPlaces(cleaned, 1);
    if (!hit && /^the\s+/i.test(cleaned)) {
      [hit] = searchPlaces(cleaned.replace(/^the\s+/i, ""), 1);
    }
    if (!hit) {
      const stripped = stripCommandWords(cleaned);
      if (stripped && stripped !== cleaned.toLowerCase()) {
        [hit] = searchPlaces(stripped, 1);
      }
    }
    if (!hit) {
      const words = stripCommandWords(cleaned).split(/\s+/).filter(Boolean);
      for (let len = Math.min(3, words.length); len >= 1; len -= 1) {
        for (let i = 0; i <= words.length - len; i += 1) {
          const slice = words.slice(i, i + len).join(" ");
          if (slice.length < 2) continue;
          const [match] = searchPlaces(slice, 1);
          if (match) return match;
        }
      }
    }
    return hit || null;
  }

  async function readPlaceStat(place, variable) {
    try {
      if (place.type === "country") {
        const countries = await loadPlaceCountries();
        const entry = countries.find((c) => c.id === place.id);
        return formatStat(entry?.[variable], variable);
      }
      const cities = await loadPlaceCities(place.country_code);
      const entry = cities.find((c) => String(c.id) === String(place.id));
      return formatStat(entry?.[variable], variable);
    } catch {
      return "";
    }
  }

  async function execute(step) {
    const { tool, args } = step;
    switch (tool) {
      case "set_indicator": {
        actions.setVariable(args.name);
        return `Indicator set to ${VARIABLES[args.name]?.label || args.name}.`;
      }
      case "set_live": {
        const ok = await actions.setLive(args.on);
        if (!ok) throw new Error("live data unavailable");
        return args.on ? "Live Open-Meteo overlay enabled." : "Returned to the trend field.";
      }
      case "set_base": {
        const ok = await actions.setBase(args.mode);
        if (!ok) throw new Error("base unavailable");
        if (args.mode === "satellite") return "NASA GIBS true-color imagery loaded.";
        if (args.mode === "data") return "Dark data base enabled.";
        return "Natural Earth base restored.";
      }
      case "select_region": {
        const regions = await loadRegions();
        const region = regions.regions.find((r) => r.name.toLowerCase() === args.name);
        if (!region) throw new Error(`no region named ${args.name}`);
        actions.selectRegion(region);
        const variable = actions.getVariable();
        const stat = formatStat(region[variable], variable);
        return stat ? `Focused ${region.name} · ${stat}.` : `Focused ${region.name}.`;
      }
      case "region_contrast": {
        const pair = await actions.contrast();
        if (!pair) throw new Error("not enough regional records");
        const variable = actions.getVariable();
        const cfg = VARIABLES[variable];
        return `Contrast set: ${pair.primary.name} (${fmtSigned(pair.primary.slope, cfg.decimals)} ${cfg.units}) vs ${pair.secondary.name} (${fmtSigned(pair.secondary.slope, cfg.decimals)} ${cfg.units}).`;
      }
      case "compare_places": {
        const pair = await actions.comparePlaces(args.primary, args.secondary);
        if (!pair) throw new Error(`could not match both “${args.primary}” and “${args.secondary}”`);
        return `Comparing ${pair.primaryName} vs ${pair.secondaryName}.`;
      }
      case "top_trend": {
        const [data, locations] = await Promise.all([
          loadTopTrends(),
          loadCellLocations().catch(() => null),
        ]);
        const variable = actions.getVariable();
        const cfg = VARIABLES[variable];
        const list = data.variables[variable]?.[args.direction] || [];
        if (!list.length) throw new Error("no ranked cells");
        const best = [...list].sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))[0];
        actions.selectTrendCell(best);
        const key = `${Number(best.lat).toFixed(2)}_${Number(best.lon).toFixed(2)}`;
        const placeName = locations?.[key]?.country || locations?.[key]?.label || "";
        const prefix = placeName ? `${placeName} (${best.lat.toFixed(2)}°, ${best.lon.toFixed(2)}°)` : `${best.lat.toFixed(2)}°, ${best.lon.toFixed(2)}°`;
        return `Strongest ${args.direction === "increases" ? cfg.increase : cfg.decrease}: ${prefix} · ${fmtSigned(best.slope, cfg.decimals)} ${cfg.units} · p = ${fmtP(best.p)}.`;
      }
      case "focus_place": {
        const hit = await findPlace(args.query);
        if (!hit) throw new Error(`no place matches “${args.query}”`);
        actions.selectPlace(hit);
        const variable = actions.getVariable();
        const stat = await readPlaceStat(hit, variable);
        const where = hit.type === "city" && hit.country ? `${hit.name}, ${hit.country}` : hit.name;
        return stat ? `Focused ${where} · ${stat}.` : `Focused ${where}.`;
      }
      case "reset_view": {
        actions.resetView();
        return "View reset to the global mean.";
      }
      case "summarize": {
        const regions = await loadRegions();
        const variable = args.variable;
        const cfg = VARIABLES[variable];
        const globalEntry = regions.regions.find((r) => r.name === "Global");
        const rows = regions.regions.filter((r) => r.name !== "Global" && Number.isFinite(r[variable]?.slope));
        if (!rows.length) throw new Error("no regional records available");
        const top = [...rows].sort((a, b) => b[variable].slope - a[variable].slope)[0];
        const bottom = [...rows].sort((a, b) => a[variable].slope - b[variable].slope)[0];
        actions.selectRegion(top);
        const globalText = Number.isFinite(globalEntry?.[variable]?.slope)
          ? `Global mean: ${fmtSigned(globalEntry[variable].slope, cfg.decimals)} ${cfg.units} (p = ${fmtP(globalEntry[variable].p)}). `
          : "";
        return `${globalText}Steepest ${cfg.label.toLowerCase()} rise: ${top.name} (${fmtSigned(top[variable].slope, cfg.decimals)} ${cfg.units}); lowest: ${bottom.name} (${fmtSigned(bottom[variable].slope, cfg.decimals)} ${cfg.units}).`;
      }
      default:
        throw new Error(`unknown tool ${tool}`);
    }
  }

  async function run(goal) {
    const token = ++runToken;
    const steps = planGoal(goal, {
      variable: actions.getVariable(),
      liveMode: actions.getLive?.() ?? false,
    });
    trace?.({ id: "plan", tool: "plan", state: "plan", detail: steps.map((s) => s.tool).join(" → ") || "no-op" });
    const notes = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const id = `step-${i}`;
      if (token !== runToken) return { cancelled: true, notes };
      log(id, step, "running", "running…");
      try {
        const detail = await execute(step);
        if (token !== runToken) return { cancelled: true, notes };
        log(id, step, "done", detail);
        notes.push(detail);
      } catch (error) {
        log(id, step, "failed", error.message);
        notes.push(`${step.tool} failed: ${error.message}`);
      }
      if (i < steps.length - 1) {
        await new Promise((r) => setTimeout(r, 260));
      }
    }
    if (token !== runToken) return { cancelled: true, notes };
    trace?.({ id: "result", tool: "result", state: "done", detail: notes.join(" ") });
    return { cancelled: false, notes };
  }

  function stop() {
    runToken += 1;
  }

  return { run, stop, planGoal };
}
