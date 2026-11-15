/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
import { INITIAL_VARIABLE, VARIABLES } from "./config.js";
import { createSiAgent } from "./agent.js";
import { loadRegions, loadTrends } from "./data.js";
import { createDetails } from "./details.js";
import { initDepth } from "./depth.js";
import { initGlobe } from "./globe.js";
import { buildFiveDegreeGrid } from "./heat.js";
import { LIVE, fetchLiveTemperatures, indexLiveValues, resolveGibsDate } from "./live.js";
import { ensurePlaceSearch, searchPlaces } from "./places.js";
import { createPlaceSearch } from "./search.js";
import { initSpace } from "./space.js";
import { initTheme } from "./theme.js";
import { fmtP, fmtSigned } from "./utils.js";

const state = {
  variable: INITIAL_VARIABLE,
  selection: { kind: "global" },
  compare: null,
  compareMode: false,
  countryMode: false,
  liveMode: false,
};

let liveFetchedAt = null;
let legendKeyDefault = "";
let refreshLiveSwitch = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let globe = null;
let details = null;

function setStatus({ state: statusState, text, retry = false }) {
  const strip = $("#global-status");
  if (!strip) return;
  strip.classList.remove("is-loading", "is-ready", "is-error");
  strip.classList.add(`is-${statusState}`);
  $("#status-text").textContent = text;
  $("#btn-retry-data").hidden = !retry;
}

function renderDetails() {
  details?.show({
    selection: state.selection,
    variable: state.variable,
    compare: state.compare,
    compareMode: state.compareMode,
  });
}

function scrollDetailsIntoView() {
  if (window.innerWidth > 960) return;
  $("#details-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function regionCenter(bounds) {
  return {
    lat: (bounds.lat_min + bounds.lat_max) / 2,
    lon: (bounds.lon_min + bounds.lon_max) / 2,
  };
}

function selectionLabel(selection) {
  if (!selection || selection.kind === "global") return "Planet Earth";
  if (selection.kind === "city") return selection.place.name;
  if (selection.kind === "country" || selection.kind === "region") return selection.name;
  if (selection.kind === "cell") {
    return `5° cell at ${selection.cell.lat.toFixed(2)}°, ${selection.cell.lon.toFixed(2)}°`;
  }
  return "this place";
}

function pointFor(selection) {
  if (selection.kind === "city") return { lat: selection.place.lat, lon: selection.place.lon };
  if (selection.kind === "country" && Number.isFinite(selection.lat)) {
    return { lat: selection.lat, lon: selection.lon };
  }
  return null;
}

function clearCompareState() {
  state.compareMode = false;
  state.compare = null;
  globe?.setPickMode("primary");
  globe?.setCompareCell(null);
  globe?.setExternalCompare(null);
  const button = $("#btn-compare");
  if (button) {
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Compare";
  }
  updateGlobeHint();
}

function selectPlace(selection, { exitCompare = false } = {}) {
  if (exitCompare && state.compareMode) clearCompareState();
  const point = pointFor(selection);
  const altitude = selection.kind === "country" ? 1.75 : 1.35;
  if (state.compareMode) {
    state.compare = selection;
    globe?.setExternalCompare(point, { fly: Boolean(point), altitude });
    setStatus({ state: "ready", text: `Comparison set to ${selectionLabel(selection)}.` });
  } else {
    state.selection = selection;
    globe?.setExternalSelection(point, { fly: Boolean(point), altitude });
    setStatus({ state: "ready", text: `Selected ${selectionLabel(selection)}.` });
  }
  renderDetails();
}

function selectionFromPlace(place) {
  if (place.type === "country") {
    return {
      kind: "country",
      code: place.id,
      name: place.name,
      continent: place.continent,
      lat: place.lat,
      lon: place.lon,
    };
  }
  return { kind: "city", place };
}

function selectRegion({ name, bounds }) {
  if (state.compareMode) clearCompareState();
  state.selection = { kind: "region", name, bounds };
  globe?.setExternalSelection(null);
  if (bounds) {
    const center = regionCenter(bounds);
    globe?.flyTo(center.lat, center.lon, 1.7);
  }
  setStatus({ state: "ready", text: `Selected ${name} · area-weighted regional mean.` });
  renderDetails();
  scrollDetailsIntoView();
}

function selectTrendCell(item) {
  if (state.compareMode) clearCompareState();
  const cell = { lat: item.lat, lon: item.lon };
  const variable = VARIABLES[state.variable];
  state.selection = { kind: "cell", cell };
  globe?.setExternalSelection(cell, { fly: true, altitude: 1.35 });
  setStatus({
    state: "ready",
    text: `Jumped to ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}° · ${fmtSigned(item.slope, variable.decimals)} ${variable.units} · p = ${fmtP(item.p)}.`,
  });
  renderDetails();
  scrollDetailsIntoView();
}

function showRegionContrast({ primary, secondary, note }) {
  const variable = VARIABLES[state.variable];
  const statusText = `Contrast: ${primary.name} (${fmtSigned(primary.slope, variable.decimals)} ${variable.units}) vs ${secondary.name} (${fmtSigned(secondary.slope, variable.decimals)} ${variable.units}).${note ? ` ${note}` : ""}`;
  setCompareMode(true, {
    selection: { kind: "region", name: primary.name, bounds: primary.bounds },
    compare: { kind: "region", name: secondary.name, bounds: secondary.bounds },
    statusText,
    fly: regionCenter(primary.bounds),
  });
  scrollDetailsIntoView();
}

async function compareTargets(primaryQuery, secondaryQuery) {
  const [regionsData] = await Promise.all([loadRegions(), ensurePlaceSearch()]);
  const resolveTarget = (query) => {
    const q = query.trim().toLowerCase();
    const region = regionsData.regions.find((r) => r.name.toLowerCase() === q);
    if (region) return { kind: "region", name: region.name, bounds: region.bounds };
    const [place] = searchPlaces(query, 1);
    return place ? selectionFromPlace(place) : null;
  };

  const primary = resolveTarget(primaryQuery);
  const secondary = resolveTarget(secondaryQuery);
  if (!primary || !secondary) return null;

  const primaryPt = pointFor(primary) || (primary.bounds ? regionCenter(primary.bounds) : null);
  const secondaryPt = pointFor(secondary) || (secondary.bounds ? regionCenter(secondary.bounds) : null);

  setCompareMode(true, {
    selection: primary,
    compare: secondary,
    statusText: `Comparing ${selectionLabel(primary)} vs ${selectionLabel(secondary)}.`,
    fly: primaryPt,
  });

  if (primary.kind !== "region" && primaryPt) {
    globe?.setExternalSelection(primaryPt, { fly: true, altitude: 1.55 });
  }
  if (secondary.kind !== "region" && secondaryPt) {
    globe?.setExternalCompare(secondaryPt);
  }
  scrollDetailsIntoView();
  return {
    primaryName: selectionLabel(primary),
    secondaryName: selectionLabel(secondary),
  };
}

function updateGlobeHint() {
  const hint = $("#globe-hint");
  if (hint) {
    if (state.compareMode) {
      hint.textContent = state.countryMode
        ? "Click a second country to compare · drag to orbit"
        : "Click a second cell or search a place to compare · drag to orbit";
    } else {
      hint.textContent = state.countryMode
        ? "Country mode · click a country · drag to orbit"
        : "Drag to orbit · scroll to zoom · click a 5° cell";
    }
  }
  const globeEl = $("#globe");
  if (globeEl) {
    globeEl.setAttribute(
      "aria-label",
      state.countryMode
        ? "Interactive 3D globe in country mode. Click a country, or use the place search for a keyboard-accessible alternative."
        : "Interactive 3D globe showing climate trend cells. Use the place search for a keyboard-accessible alternative.",
    );
  }
}

function setupSearch() {
  createPlaceSearch({
    input: $("#place-search"),
    list: $("#search-results"),
    status: $("#search-status"),
    onSelect: (place) => selectPlace(selectionFromPlace(place)),
  });
}

function setupCountryMode() {
  const button = $("#btn-country");
  button.addEventListener("click", async () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    if (next) {
      button.disabled = true;
      setStatus({ state: "loading", text: "Loading country outlines…" });
      const ok = (await globe?.setCountryMode(true)) ?? false;
      button.disabled = false;
      if (!ok) {
        setStatus({
          state: "error",
          text: "Country mode could not start because the country outlines did not load.",
        });
        return;
      }
    } else {
      await globe?.setCountryMode(false);
    }
    state.countryMode = next;
    button.setAttribute("aria-pressed", String(next));
    updateGlobeHint();
    setStatus({
      state: "ready",
      text: next
        ? "Country mode · click any country for its area-weighted national trends."
        : "Country mode off · click a 5° cell to inspect its local trend.",
    });
  });
}

function fmtUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function renderLegend() {
  const variable = VARIABLES[state.variable];
  const legendKey = $("#legend-key");
  if (state.liveMode) {
    $("#legend-title").textContent = LIVE.title;
    $("#legend-period").textContent = LIVE.period;
    $("#legend-direction").textContent = LIVE.direction;
    $("#legend-unit").textContent = LIVE.unit;
    $("#legend-min").textContent = fmtSigned(-LIVE.domain, 0);
    $("#legend-max").textContent = fmtSigned(LIVE.domain, 0);
    if (legendKey) legendKey.textContent = `${LIVE.source} current conditions · fetched ${fmtUtc(liveFetchedAt)}`;
    $("#globe-footnote").textContent =
      `Live 2 m air temperature from ${LIVE.source}, fetched ${fmtUtc(liveFetchedAt)}. A snapshot, not a trend.`;
    $("#chart-source").textContent = `${variable.source} (chart) · ${LIVE.source} (globe)`;
    return;
  }
  $("#legend-title").textContent = `${variable.label} slope`;
  $("#legend-period").textContent = variable.years;
  $("#legend-direction").textContent = variable.legendDirection;
  $("#legend-unit").textContent = variable.shortUnits;
  $("#legend-min").textContent = fmtSigned(-variable.domain, variable.tickDecimals);
  $("#legend-max").textContent = fmtSigned(variable.domain, variable.tickDecimals);
  if (legendKey && legendKeyDefault) legendKey.innerHTML = legendKeyDefault;
  $("#globe-footnote").textContent =
    `5° cell slopes in ${variable.units}, centered on zero. Dot = p < 0.05.`;
  $("#chart-source").textContent = variable.source;
}

function applyVariable(name) {
  const variable = VARIABLES[name];
  if (!variable) return;
  state.variable = name;
  document.body.dataset.activeVariable = name;

  for (const tab of $$(".variable-tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.variable === name));
    tab.tabIndex = tab.dataset.variable === name ? 0 : -1;
  }

  $("#meta-years").textContent = variable.years;
  $("#meta-units").textContent = variable.units;

  if (state.liveMode && name !== "temperature") {
    state.liveMode = false;
    globe?.clearLive();
    refreshLiveSwitch?.();
  }
  renderLegend();

  globe?.setVariable(name);
  renderDetails();
}

function setupTabs() {
  const tabs = $$(".variable-tab");
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => applyVariable(tab.dataset.variable));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  });
}

function setupMethods() {
  const dialog = $("#methods-dialog");
  if (!dialog) return;
  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  const close = () => {
    if (dialog.open) dialog.close();
  };
  for (const button of $$("[data-open-methods]")) button.addEventListener("click", open);
  $("#btn-methods").addEventListener("click", open);
  $("#btn-close-methods").addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  const tbody = $("#methods-scales tbody");
  tbody.innerHTML = Object.values(VARIABLES)
    .map(
      (variable) => `<tr>
        <td>${variable.label}</td>
        <td>±${fmtSigned(variable.domain, variable.tickDecimals).replace("+", "")} ${variable.units}</td>
        <td>${variable.years}</td>
      </tr>`,
    )
    .join("");
}

function setupStart() {
  $("#btn-start").addEventListener("click", () => {
    const search = $("#place-search");
    document.querySelector(".control-deck").scrollIntoView({ block: "start", behavior: "smooth" });
    search.focus({ preventScroll: true });
    $("#search-status").textContent = "Search a country or city, choose an indicator, or click a cell on the globe.";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
    event.preventDefault();
    $("#place-search").focus();
  });
}

async function setLiveMode(on) {
  if (on) {
    if (state.variable !== "temperature") applyVariable("temperature");
    let cells = globe?.getCells?.();
    if (!cells || !cells.length) {
      try {
        if (globe) {
          await globe.setVariable("temperature");
          cells = globe.getCells?.();
        }
        if (!cells || !cells.length) {
          const data = await loadTrends("temperature");
          cells = data?.cells || null;
        }
      } catch {
        cells = null;
      }
    }
    if (!cells || !cells.length) {
      cells = buildFiveDegreeGrid();
    }
    setStatus({ state: "loading", text: "Fetching live Open-Meteo temperatures…" });
    try {
      const { values, fetchedAt, cached, partial } = await fetchLiveTemperatures(cells);
      liveFetchedAt = fetchedAt;
      globe?.setLive(indexLiveValues(cells, values), LIVE.domain, cells);
      state.liveMode = true;
      refreshLiveSwitch?.();
      renderLegend();
      setStatus({
        state: "ready",
        text: cached
          ? `Live temperatures from your cache, fetched ${fmtUtc(fetchedAt)}.`
          : partial
            ? `Live temperatures fetched ${fmtUtc(fetchedAt)} from Open-Meteo; a rate limit left some areas blank.`
            : `Live temperatures fetched ${fmtUtc(fetchedAt)} from Open-Meteo.`,
      });
      return true;
    } catch (error) {
      state.liveMode = false;
      globe?.clearLive();
      refreshLiveSwitch?.();
      renderLegend();
      setStatus({ state: "error", text: `Live data could not load. ${error.message}`, retry: true });
      return false;
    }
  }
  state.liveMode = false;
  globe?.clearLive();
  refreshLiveSwitch?.();
  renderLegend();
  setStatus({ state: "ready", text: "Back to the 2014–2025 trend field." });
  return true;
}

function setupLiveSwitch() {
  const group = $("#live-switch");
  if (!group) return;
  const buttons = $$("button[data-mode]", group);
  refreshLiveSwitch = () => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String((button.dataset.mode === "live") === state.liveMode));
    }
  };
  group.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    const wantLive = button.dataset.mode === "live";
    if (wantLive === state.liveMode) return;
    button.disabled = true;
    await setLiveMode(wantLive);
    button.disabled = false;
  });
  refreshLiveSwitch();
}

async function applyBase(mode) {
  if (!globe) return false;
  const baseBtn = $("#btn-base");
  if (mode === "satellite") {
    setStatus({ state: "loading", text: "Contacting NASA GIBS for the latest true-color imagery…" });
    const date = await resolveGibsDate();
    if (!date) {
      setStatus({ state: "error", text: "NASA GIBS imagery is unavailable right now — staying on the previous base." });
      return false;
    }
    await globe.setBase("satellite", date);
    if (baseBtn) {
      baseBtn.textContent = `Satellite ${date.slice(5)}`;
      baseBtn.setAttribute("aria-pressed", "false");
    }
    setStatus({ state: "ready", text: `NASA GIBS true-color imagery for ${date} (latest available pass).` });
    return true;
  }
  await globe.setBase(mode);
  if (baseBtn) {
    baseBtn.textContent = mode === "natural" ? "Natural Earth" : "Data base";
    baseBtn.setAttribute("aria-pressed", String(mode === "natural"));
  }
  setStatus({
    state: "ready",
    text: mode === "natural" ? "Natural Earth base restored." : "Dark data base active.",
  });
  return true;
}

async function computeContrast() {
  const variable = state.variable;
  const config = VARIABLES[variable];
  const data = await loadRegions();
  const rows = data.regions.filter((region) => region.name !== "Global" && Number.isFinite(region[variable]?.slope));
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a[variable].slope - b[variable].slope);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const opposite = lowest[variable].slope < 0 && highest[variable].slope > 0;
  const pair = {
    primary: { name: highest.name, bounds: highest.bounds, slope: highest[variable].slope },
    secondary: { name: lowest.name, bounds: lowest.bounds, slope: lowest[variable].slope },
    note: opposite
      ? ""
      : `No named region is ${config.decrease} for ${config.label.toLowerCase()}; showing the widest spread instead.`,
  };
  showRegionContrast(pair);
  return pair;
}

function setupAgent() {
  const traceEl = $("#agent-trace");
  const form = $("#agent-form");
  const input = $("#agent-goal");
  const runBtn = $("#agent-run");
  const stopBtn = $("#agent-stop");
  if (!form || !traceEl) return;

  let activeSubmitId = 0;

  const agent = createSiAgent({
    trace: ({ id, tool, state: stepState, detail }) => {
      let li = traceEl.querySelector(`[data-id="${id}"]`);
      if (!li) {
        li = document.createElement("li");
        li.className = "agent-step";
        li.dataset.id = id;
        const toolSpan = document.createElement("span");
        toolSpan.className = "agent-tool";
        const detailSpan = document.createElement("span");
        detailSpan.className = "agent-detail";
        li.append(toolSpan, detailSpan);
        traceEl.append(li);
      }
      li.dataset.state = stepState;
      li.querySelector(".agent-tool").textContent = tool;
      li.querySelector(".agent-detail").textContent = detail || "";
      if (id === "result" && stepState === "done") {
        traceEl.querySelectorAll(".agent-si-tag").forEach((node) => node.remove());
        const tag = document.createElement("li");
        tag.className = "agent-si-tag";
        tag.textContent = "✦ SI-generated answer. May contain errors.";
        traceEl.append(tag);
      }
    },
    actions: {
      getVariable: () => state.variable,
      getLive: () => state.liveMode,
      setVariable: (name) => applyVariable(name),
      setLive: (on) => setLiveMode(on),
      setBase: (mode) => applyBase(mode),
      selectRegion: (region) => selectRegion({ name: region.name, bounds: region.bounds }),
      selectTrendCell: (item) => selectTrendCell(item),
      selectPlace: (place) => selectPlace(selectionFromPlace(place), { exitCompare: true }),
      contrast: () => computeContrast(),
      comparePlaces: (primary, secondary) => compareTargets(primary, secondary),
      resetView: () => {
        if (state.compareMode) clearCompareState();
        state.selection = { kind: "global" };
        globe?.setExternalSelection(null);
        globe?.resetView();
        setStatus({ state: "ready", text: "Reset to Planet Earth global average." });
        renderDetails();
      },
    },
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const goal = input.value.trim();
    if (!goal) {
      input.focus();
      return;
    }
    agent.stop();
    const submitId = ++activeSubmitId;
    traceEl.innerHTML = "";
    runBtn.disabled = true;
    stopBtn.hidden = false;
    try {
      const result = await agent.run(goal);
      if (submitId === activeSubmitId && result.cancelled) {
        const li = document.createElement("li");
        li.className = "agent-step";
        li.dataset.state = "failed";
        li.innerHTML = `<span class="agent-tool">stopped</span><span class="agent-detail">Run cancelled.</span>`;
        traceEl.append(li);
      }
    } finally {
      if (submitId === activeSubmitId) {
        runBtn.disabled = false;
        stopBtn.hidden = true;
      }
    }
  });

  stopBtn.addEventListener("click", () => agent.stop());

  $("#agent-chips")?.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    input.value = chip.textContent;
    form.requestSubmit();
  });
}

function setupGlobeControls() {
  const labelsBtn = $("#btn-layers");
  labelsBtn.addEventListener("click", () => {
    const on = labelsBtn.getAttribute("aria-pressed") !== "true";
    labelsBtn.setAttribute("aria-pressed", String(on));
    globe?.setLabels(on);
  });

  const rotateBtn = $("#btn-rotate");
  rotateBtn.setAttribute("aria-pressed", String(globe?.getRotation() ?? false));
  rotateBtn.addEventListener("click", () => {
    if (!globe) return;
    const on = globe.toggleRotation();
    rotateBtn.setAttribute("aria-pressed", String(on));
  });

  const baseBtn = $("#btn-base");
  baseBtn.setAttribute("aria-pressed", "true");
  baseBtn.addEventListener("click", async () => {
    if (!globe) return;
    const order = ["natural", "data", "satellite"];
    const next = order[(order.indexOf(globe.getBase()) + 1) % order.length];
    baseBtn.disabled = true;
    await applyBase(next);
    baseBtn.disabled = false;
  });

  $("#btn-reset").addEventListener("click", () => globe?.resetView());
  $("#btn-retry-globe").addEventListener("click", () => window.location.reload());
  $("#btn-retry-data").addEventListener("click", () => {
    globe?.reload();
    renderDetails();
  });
}

function setCompareMode(on, preset = null) {
  state.compareMode = Boolean(on);
  state.compare = preset?.compare || null;
  if (preset?.selection) state.selection = preset.selection;

  globe?.setPickMode(state.compareMode ? "compare" : "primary");
  globe?.setCompareCell(null);
  if (preset) {
    globe?.setExternalSelection(null);
    globe?.setExternalCompare(null);
  }

  const button = $("#btn-compare");
  button.setAttribute("aria-pressed", String(state.compareMode));
  button.textContent = state.compareMode ? "Cancel" : "Compare";

  updateGlobeHint();

  if (state.compareMode) {
    setStatus({
      state: "ready",
      text:
        preset?.statusText ||
        (state.countryMode
          ? "Pick a second country on the globe to compare with the current selection."
          : "Pick a second cell on the globe, or search a place, to compare with the current selection."),
    });
  } else {
    setStatus({
      state: "ready",
      text: state.countryMode
        ? "Comparison cleared. Click a country or search a place to inspect it."
        : "Comparison cleared. Click a cell, or search a place, to inspect it.",
    });
  }
  renderDetails();
  if (preset?.fly) globe?.flyTo(preset.fly.lat, preset.fly.lon, 1.75);
}

function setupCompare() {
  $("#btn-compare").addEventListener("click", () => setCompareMode(!state.compareMode));
  $("#btn-compare-clear").addEventListener("click", () => setCompareMode(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.compareMode) setCompareMode(false);
  });
}

function setupGlobe() {
  globe = initGlobe({
    container: $("#globe"),
    stage: $("#globe-stage"),
    labelsContainer: $("#globe-labels"),
    onStatus: setStatus,
    onSelect: (cell, _variable, clickPoint) => {
      state.selection = cell ? { kind: "cell", cell, clickPoint } : { kind: "global" };
      renderDetails();
    },
    onCompare: (cell, _variable, clickPoint) => {
      state.compare = cell ? { kind: "cell", cell, clickPoint } : null;
      renderDetails();
    },
    onCountryPick: (country, lat, lon) => {
      selectPlace({
        kind: "country",
        code: country.code,
        name: country.name,
        continent: country.continent,
        lat,
        lon,
      });
    },
  });

  if (!globe) {
    $("#globe-loading").hidden = true;
    $("#globe-error").hidden = false;
    $("#btn-country").disabled = true;
    setStatus({
      state: "error",
      text: "The 3D globe could not start. Search and the trend panels still work.",
    });
  }
}

function init() {
  initSpace();
  initTheme();
  initDepth();
  legendKeyDefault = $("#legend-key")?.innerHTML || "";
  details = createDetails({ onVariableChange: (name) => applyVariable(name) });
  setupTabs();
  setupMethods();
  setupStart();
  setupSearch();
  setupCompare();
  setupCountryMode();
  setupGlobe();
  setupGlobeControls();
  setupLiveSwitch();
  setupAgent();
  applyVariable(INITIAL_VARIABLE);
}

init();
