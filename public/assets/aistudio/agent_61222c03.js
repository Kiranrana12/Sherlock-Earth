// SI agent: a goal-driven tool loop, not a chat window.
// It reads a goal, plans an ordered list of tool calls over the site's own
// data (regions.json, top_trends.json, the place index, the live API) and
// executes them against the atlas, narrating every step in a visible trace.

import { VARIABLES } from "./config.js";
import { loadRegions, loadTopTrends } from "./data.js";
import { ensurePlaceSearch, searchPlaces } from "./places.js";
import { fmtSigned } from "./utils.js";

const INDICATOR_WORDS = [
  ["temperature", ["temperature", "temp", "warming", "heat", "hot", "°c"]],
  ["precipitation", ["precipitation", "rain", "rainfall", "wet", "dry"]],
  ["humidity", ["humidity", "humid", "moist", "vapor", "vapour"]],
  ["wind", ["wind", "breeze", "gale"]],
];

const REGION_ALIASES = {
  "amazon basin": ["amazon"],
  sahel: ["sahel"],
  "south asia": ["south asia", "india", "monsoon asia"],
  arctic: ["arctic", "polar north", "high north"],
  "southeast asia": ["southeast asia", "sea region"],
  mediterranean: ["mediterranean"],
};

function lower(goal) {
  return goal.toLowerCase();
}

function has(text, words) {
  return words.some((w) => text.includes(w));
}

/** Pure planner: goal text -> ordered tool steps. No network, no DOM. */
export function planGoal(goal, { variable }) {
  const text = lower(goal);
  const steps = [];

  const indicator = INDICATOR_WORDS.find(([, words]) => has(text, words))?.[0];
  if (indicator && indicator !== variable) {
    steps.push({ tool: "set_indicator", args: { name: indicator } });
  }
  const activeVariable = indicator || variable;

  if (has(text, ["live", "current conditions", "right now", "real time", "realtime"])) {
    steps.push({ tool: "set_live", args: { on: true } });
  } else if (has(text, ["trend", "slope", "since 2014", "over time"])) {
    steps.push({ tool: "set_live", args: { on: false } });
  }

  if (has(text, ["satellite", "imagery", "gibs", "true color", "truecolor"])) {
    steps.push({ tool: "set_base", args: { mode: "satellite" } });
  } else if (has(text, ["natural earth", "plain globe", "map base"])) {
    steps.push({ tool: "set_base", args: { mode: "natural" } });
  }

  const regionKey = Object.keys(REGION_ALIASES).find((name) => has(text, [name, ...REGION_ALIASES[name]]));
  const wantsContrast = has(text, ["contrast", "compare", "versus", " vs ", "difference between", "against"]);
  const wantsExtreme = has(text, ["fastest", "strongest", "most", "biggest", "extreme", "where is", "which place", "show me the top"]);
  const wantsDecrease = has(text, ["cooling", "decreasing", "dropping", "declining", "weakening", "drying", "drier", "least", "slowest", "coldest"]);

  if (wantsContrast) {
    steps.push({ tool: "region_contrast", args: {} });
  } else if (regionKey) {
    steps.push({ tool: "select_region", args: { name: regionKey } });
  } else if (wantsExtreme) {
    steps.push({ tool: "top_trend", args: { direction: wantsDecrease ? "decreases" : "increases" } });
  } else {
    const placeStep = planPlace(text);
    if (placeStep) steps.push(placeStep);
  }

  if (has(text, ["reset", "clear", "start over", "back to global"])) {
    steps.push({ tool: "reset_view", args: {} });
  }

  if (!steps.length) {
    steps.push({ tool: "summarize", args: { variable: activeVariable } });
  }
  return steps;
}

function planPlace(text) {
  const match = text.match(/\b(in|over|around|for|to|show|focus on)\s+([a-z][a-z\s'.-]{2,40})$/);
  const candidate = (match?.[2] || text).trim();
  if (candidate.length < 3) return null;
  return { tool: "focus_place", args: { query: candidate } };
}

export function createSiAgent({ trace, actions }) {
  let runToken = 0;

  function log(id, step, state, detail) {
    trace?.({ id, tool: step.tool, state, detail });
  }

  async function execute(step) {
    const { tool, args } = step;
    switch (tool) {
      case "set_indicator": {
        actions.setVariable(args.name);
        return `Indicator set to ${args.name}.`;
      }
      case "set_live": {
        const ok = await actions.setLive(args.on);
        if (!ok) throw new Error("live data unavailable");
        return args.on ? "Live Open-Meteo overlay enabled." : "Returned to the trend field.";
      }
      case "set_base": {
        const ok = await actions.setBase(args.mode);
        if (!ok) throw new Error("base unavailable");
        return args.mode === "satellite" ? "NASA GIBS true-color imagery loaded." : "Natural Earth base restored.";
      }
      case "select_region": {
        const regions = await loadRegions();
        const region = regions.regions.find((r) => r.name.toLowerCase() === args.name);
        if (!region) throw new Error(`no region named ${args.name}`);
        actions.selectRegion(region);
        return `Focused ${region.name}.`;
      }
      case "region_contrast": {
        const pair = await actions.contrast();
        if (!pair) throw new Error("not enough regional records");
        return `Contrast set: ${pair.primary.name} vs ${pair.secondary.name}.`;
      }
      case "top_trend": {
        const data = await loadTopTrends();
        const variable = actions.getVariable();
        const list = data.variables[variable]?.[args.direction] || [];
        if (!list.length) throw new Error("no ranked cells");
        const best = [...list].sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))[0];
        actions.selectTrendCell(best);
        return `Strongest ${args.direction === "increases" ? "increase" : "decrease"} at ${best.lat.toFixed(2)}°, ${best.lon.toFixed(2)}° · ${fmtSigned(best.slope, 4)} ${VARIABLES[variable].units} · p = ${best.p.toFixed(4)}.`;
      }
      case "focus_place": {
        await ensurePlaceSearch();
        const [hit] = searchPlaces(args.query, 1);
        if (!hit) throw new Error(`no place matches “${args.query}”`);
        actions.selectPlace(hit);
        return `Focused ${hit.name}.`;
      }
      case "reset_view": {
        actions.resetView();
        return "View reset to the global mean.";
      }
      case "summarize": {
        const regions = await loadRegions();
        const variable = args.variable;
        const rows = regions.regions.filter((r) => r.name !== "Global" && Number.isFinite(r[variable]?.slope));
        const top = [...rows].sort((a, b) => b[variable].slope - a[variable].slope)[0];
        const bottom = [...rows].sort((a, b) => a[variable].slope - b[variable].slope)[0];
        actions.selectRegion(top);
        return `Steepest ${variable} rise: ${top.name} (${fmtSigned(top[variable].slope, 4)}); steepest fall: ${bottom.name} (${fmtSigned(bottom[variable].slope, 4)}).`;
      }
      default:
        throw new Error(`unknown tool ${tool}`);
    }
  }

  async function run(goal) {
    const token = ++runToken;
    const steps = planGoal(goal, { variable: actions.getVariable() });
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
      await new Promise((r) => setTimeout(r, 260));
    }
    trace?.({ id: "result", tool: "result", state: "done", detail: notes.join(" ") });
    return { cancelled: false, notes };
  }

  function stop() {
    runToken += 1;
  }

  return { run, stop, planGoal };
}
