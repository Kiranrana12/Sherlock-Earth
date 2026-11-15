// Details panel: turns any selection into a four-indicator record, renders the
// headline trend, the annual chart and the companion cards. Each indicator is
// loaded independently so a single failed file only disables its own card.

import { SIGNIFICANCE_LEVEL, VARIABLES, VARIABLE_ORDER } from "./config.js";
import { loadCellLocations, loadPlaceCountries, loadPlaceCities, loadRegions, loadTrends } from "./data.js";
import { indexCells, cellIndex } from "./heat.js";
import { cssVarColor, destroyChart, ensureCharts, renderSeriesChart, renderSparkline, retryCharts } from "./charts.js";
import { capitalise, escapeHTML, fmtBounds, fmtCoord, fmtP, fmtSigned, trendWord } from "./utils.js";

const recordsByData = new WeakMap();

function cellMapFor(variable, data) {
  let map = recordsByData.get(data);
  if (!map) {
    map = indexCells(data.cells);
    recordsByData.set(data, map);
  }
  return map;
}

function locationKey(lat, lon) {
  return `${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;
}

function rangeLabel(record) {
  if (!record?.series?.length) return "";
  const values = record.series;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const decimals = Math.max(0, Math.abs(max) >= 100 ? 0 : Math.abs(max) >= 10 ? 1 : 2);
  const fmt = (value) =>
    new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return `${fmt(min)}–${fmt(max)} ${record.seriesUnits || ""}`.trim();
}

function yearsLabel(record) {
  if (!record?.years?.length) return "";
  return `${record.years[0]}–${record.years[record.years.length - 1]}`;
}

function recordFor(records, variable) {
  return records.find((record) => record.variable === variable) || null;
}

function cellSummary(record, variableName) {
  const variable = VARIABLES[variableName];
  const sig = record.p < SIGNIFICANCE_LEVEL ? "statistically significant" : "not statistically significant";
  return `${capitalise(trendWord(record.slope, variable))} at an estimated ${fmtSigned(record.slope, variable.decimals)} ${variable.units} over ${yearsLabel(record)}; ${sig} (p = ${fmtP(record.p)}).`;
}

function fallbackCellTitle(cell) {
  return `5° cell · ${fmtCoord(cell.lat, cell.lon)}`;
}

function describe(selection, locations) {
  if (selection.kind === "global") {
    return {
      type: "Global average",
      title: "Planet Earth",
      sub: "Area-weighted planetary mean · 2,592 cells",
      chartCaption: "Area-weighted annual mean with linear fit",
      chartName: "Planet Earth",
    };
  }

  if (selection.kind === "country") {
    return {
      type: "Country",
      title: selection.name,
      sub: `Area-weighted national mean${selection.continent ? ` · ${selection.continent}` : ""}`,
      chartCaption: "Area-weighted national mean with linear fit",
      chartName: selection.name,
    };
  }

  if (selection.kind === "city") {
    const place = selection.place;
    return {
      type: "City",
      title: place.name,
      sub: `Nearest native grid cell · ${place.country || place.continent || "Unknown"}`,
      chartCaption: "Annual value at the nearest native grid cell with linear fit",
      chartName: `${place.name}, ${place.country || place.continent || "Unknown"}`,
    };
  }

  if (selection.kind === "region") {
    return {
      type: "Named region",
      title: selection.name,
      sub: selection.bounds
        ? `Area-weighted regional mean · ${fmtBounds(selection.bounds)}`
        : "Area-weighted regional mean",
      chartCaption: "Area-weighted regional mean with linear fit",
      chartName: selection.name,
    };
  }

  const { cell } = selection;
  const location = locations?.[locationKey(cell.lat, cell.lon)] || null;
  const coord = fmtCoord(cell.lat, cell.lon);

  if (!location) {
    return {
      type: "5° cell",
      title: "Unmapped cell",
      sub: fallbackCellTitle(cell),
      chartCaption: "Annual value for this 5° cell with linear fit",
      chartName: `Cell ${coord}`,
    };
  }

  if (!location.is_land) {
    const ocean = location.label ? location.label.split(" (")[0] : "Open ocean";
    return {
      type: "5° cell",
      title: ocean,
      sub: `Open ocean · ${coord}`,
      chartCaption: "Annual value for this 5° cell with linear fit",
      chartName: ocean,
    };
  }

  const country = location.country || location.continent || "Unmapped cell";
  const context =
    location.country && location.continent && location.country !== location.continent
      ? `${location.continent} · ${coord}`
      : coord;
  return {
    type: "5° cell",
    title: country,
    sub: `Land cell · ${context}`,
    chartCaption: "Annual value for this 5° cell with linear fit",
    chartName: country,
  };
}

function recordsFromPlace(entry) {
  return VARIABLE_ORDER.map((variable) => {
    const record = entry?.[variable];
    if (!record) return { variable, empty: true };
    return {
      variable,
      years: record.years,
      series: record.series,
      slope: record.slope,
      p: record.p,
      summary: record.summary,
      units: record.units,
      seriesUnits: record.series_units,
    };
  });
}

async function loadRecords(selection) {
  try {
    if (selection.kind === "global" || selection.kind === "region") {
      const regions = await loadRegions();
      const entry = regions.regions.find((region) =>
        selection.kind === "global" ? region.name === "Global" : region.name === selection.name,
      );
      if (!entry) throw new Error("Region not found in regions.json");
      return recordsFromPlace(entry);
    }

    if (selection.kind === "country") {
      const countries = await loadPlaceCountries();
      const entry = countries.find((country) => country.id === selection.code);
      if (!entry) throw new Error(`No national record for ${selection.name}.`);
      return recordsFromPlace(entry);
    }

    if (selection.kind === "city") {
      const cities = await loadPlaceCities(selection.place.country_code);
      const entry = cities.find((city) => String(city.id) === String(selection.place.id));
      if (!entry) throw new Error(`No city record for ${selection.place.name}.`);
      return recordsFromPlace(entry);
    }

    if (selection.kind === "cell") {
      const settled = await Promise.allSettled(VARIABLE_ORDER.map((variable) => loadTrends(variable)));
      return VARIABLE_ORDER.map((variable, index) => {
        const result = settled[index];
        if (result.status === "rejected") {
          return { variable, error: true, message: result.reason?.message || "Request failed" };
        }
        const data = result.value;
        const cell = cellMapFor(variable, data).get(cellIndex(selection.cell.lat, selection.cell.lon));
        if (!cell) return { variable, empty: true };
        return {
          variable,
          years: data.years,
          series: cell.series,
          slope: cell.slope,
          p: cell.p,
          summary: null,
          units: data.units,
          seriesUnits: VARIABLES[variable].seriesUnits,
        };
      });
    }
  } catch (error) {
    return VARIABLE_ORDER.map((variable) => ({
      variable,
      error: true,
      message: error.message || "Request failed",
    }));
  }

  return VARIABLE_ORDER.map((variable) => ({ variable, empty: true }));
}

export function createDetails({ onVariableChange }) {
  const els = {
    type: document.getElementById("detail-type"),
    title: document.getElementById("detail-title"),
    sub: document.getElementById("detail-sub"),
    slope: document.getElementById("detail-slope"),
    unit: document.getElementById("detail-unit"),
    context: document.getElementById("detail-context"),
    p: document.getElementById("detail-p"),
    badge: document.getElementById("detail-badge"),
    chart: document.getElementById("trend-chart"),
    chartCaption: document.getElementById("chart-caption"),
    chartRange: document.getElementById("chart-range"),
    chartState: document.getElementById("chart-state"),
    cards: document.getElementById("variable-cards"),
    compareSlot: document.getElementById("compare-slot"),
    compareGrid: document.getElementById("compare-grid"),
    compareHint: document.getElementById("compare-hint"),
    compareLegend: document.getElementById("legend-compare"),
    compareLegendName: document.getElementById("legend-compare-name"),
  };

  let token = 0;
  let locationsPromise = null;
  let lastArgs = null;

  els.cards.addEventListener("click", (event) => {
    const card = event.target.closest(".variable-card");
    if (!card || card.disabled) return;
    onVariableChange?.(card.dataset.variable);
  });

  els.chartState.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-retry-chart]")) return;
    els.chartState.classList.remove("is-error");
    els.chartState.textContent = "Loading charts…";
    const ready = await retryCharts();
    if (ready && lastArgs) await show(lastArgs);
    else showChartError();
  });

  function clearCardCharts() {
    for (const canvas of els.cards.querySelectorAll("canvas")) destroyChart(canvas);
  }

  function setLoading(variable) {
    const label = VARIABLES[variable]?.label || "indicator";
    els.slope.textContent = "—";
    els.unit.textContent = "";
    els.slope.parentElement.classList.remove("is-increase", "is-decrease");
    els.p.textContent = "—";
    els.badge.className = "badge badge--none";
    els.badge.textContent = "Loading";
    els.context.textContent = `Loading the ${label.toLowerCase()} series…`;
    els.chartCaption.textContent = "Annual value with linear fit";
    els.chartRange.textContent = "";
    els.chartState.hidden = false;
    els.chartState.classList.remove("is-error");
    els.chartState.textContent = "Loading annual values…";
    clearCardCharts();
    els.cards.innerHTML = VARIABLE_ORDER.map(
      () => '<div class="variable-card is-loading" aria-hidden="true"></div>',
    ).join("");
    els.chart.setAttribute("aria-label", "Loading annual climate series");
  }

  function renderUnavailable(variable, message) {
    els.slope.textContent = "—";
    els.unit.textContent = "";
    els.slope.parentElement.classList.remove("is-increase", "is-decrease");
    els.p.textContent = "—";
    els.badge.className = "badge badge--none";
    els.badge.textContent = "Unavailable";
    els.context.textContent = `${VARIABLES[variable].label} data did not load. ${message || "The other indicators are unaffected."}`;
    els.chartCaption.textContent = "Annual value with linear fit";
    els.chartRange.textContent = "";
    els.chartState.hidden = false;
    els.chartState.classList.add("is-error");
    els.chartState.textContent = `${VARIABLES[variable].label} data could not load.`;
    els.chart.setAttribute("aria-label", `${VARIABLES[variable].label} data unavailable`);
    els.compareLegend.hidden = true;
  }

  function renderHeadline(record, variableName, detail, compareRecord, compareDetail) {
    const variable = VARIABLES[variableName];
    els.slope.textContent = fmtSigned(record.slope, variable.decimals);
    els.unit.textContent = variable.units;
    els.slope.parentElement.classList.toggle("is-increase", record.slope > 0);
    els.slope.parentElement.classList.toggle("is-decrease", record.slope < 0);
    els.p.textContent = fmtP(record.p);
    const significant = record.p < SIGNIFICANCE_LEVEL;
    els.badge.className = `badge ${significant ? "badge--sig" : "badge--nosig"}`;
    els.badge.textContent = significant ? "Significant" : "Not significant";
    els.context.textContent = record.summary || cellSummary(record, variableName);
    els.chartCaption.textContent = compareRecord
      ? `${detail.chartCaption} · ${compareDetail.chartName} highlighted`
      : detail.chartCaption;
    els.chartRange.textContent = rangeLabel(record);

    const description = record.summary
      ? record.summary
      : `Estimated ${trendWord(record.slope, variable)} trend of ${fmtSigned(record.slope, variable.decimals)} ${variable.units} from ${yearsLabel(record)}; p = ${fmtP(record.p)}.`;
    els.chart.setAttribute(
      "aria-label",
      `${variable.fullLabel} annual series for ${detail.chartName}, ${yearsLabel(record)}. ${description}`,
    );
  }

  function renderChart(record, detail, compareRecord, compareDetail) {
    renderSeriesChart(els.chart, {
      primary: record,
      primaryName: detail.chartName,
      compare: compareRecord || null,
      compareName: compareDetail?.chartName || "",
    });
    els.chartState.hidden = true;
    els.chartState.classList.remove("is-error");
    els.compareLegend.hidden = !compareRecord;
    if (compareRecord) els.compareLegendName.textContent = compareDetail?.chartName || "Comparison";
  }

  function showChartError() {
    els.chartState.hidden = false;
    els.chartState.classList.add("is-error");
    els.chartState.innerHTML =
      '<span>Charts could not load. Check the connection, then retry.</span>' +
      '<button type="button" class="text-btn" data-retry-chart>Retry charts</button>';
    els.chart.setAttribute("aria-label", "Chart library unavailable; the trend values above are still shown.");
  }

  function cardMarkup(record, variable, active) {
    const config = VARIABLES[variable];
    if (!record || record.error || record.empty) {
      return `<button type="button" class="variable-card is-empty" data-variable="${variable}" aria-pressed="false" disabled>
        <span class="variable-card-head">
          <span class="variable-card-name">${config.label}</span>
          <span class="badge badge--none">Unavailable</span>
        </span>
        <span class="variable-card-meta">${record?.error ? "Data file failed to load" : "No cell value"}</span>
      </button>`;
    }
    const significant = record.p < SIGNIFICANCE_LEVEL;
    const badge = `<span class="badge ${significant ? "badge--sig" : "badge--nosig"}">${significant ? "Significant" : "Not significant"}</span>`;
    return `<button type="button" class="variable-card${active ? " is-active" : ""}" data-variable="${variable}" aria-pressed="${active}">
      <span class="variable-card-head">
        <span class="variable-card-name">${config.label}</span>
        ${badge}
      </span>
      <span class="variable-card-value">${fmtSigned(record.slope, config.decimals)} <small>${config.units}</small></span>
      <span class="variable-card-meta">p = ${fmtP(record.p)} · ${yearsLabel(record)}</span>
      <span class="mini-chart" aria-hidden="true"><canvas></canvas></span>
    </button>`;
  }

  function renderCards(records, variable) {
    clearCardCharts();
    els.cards.innerHTML = VARIABLE_ORDER.map((name) =>
      cardMarkup(recordFor(records, name), name, name === variable),
    ).join("");
  }

  function renderSparklines(records) {
    for (const card of els.cards.querySelectorAll(".variable-card")) {
      const name = card.dataset.variable;
      const record = recordFor(records, name);
      const canvas = card.querySelector("canvas");
      if (!canvas || !record || record.error || record.empty) continue;
      renderSparkline(canvas, {
        years: record.years,
        series: record.series,
        color: cssVarColor(`--var-${name}`, VARIABLES[name].color),
        variable: name,
      });
    }
  }

  function compareCardMarkup(record, detail, variable, primary) {
    const config = VARIABLES[variable];
    if (!record || record.error || record.empty) {
      return `<div class="compare-card${primary ? " is-primary" : ""}">
        <h4>${escapeHTML(detail.title)}</h4>
        <p class="compare-meta">Data unavailable for this indicator.</p>
      </div>`;
    }
    const significant = record.p < SIGNIFICANCE_LEVEL;
    return `<div class="compare-card${primary ? " is-primary" : ""}">
      <h4><span class="compare-key" aria-hidden="true"></span>${escapeHTML(detail.title)}</h4>
      <p class="compare-slope">${fmtSigned(record.slope, config.decimals)} <span>${config.units}</span></p>
      <p class="compare-meta">p = ${fmtP(record.p)} · <span class="${significant ? "is-sig" : "is-nosig"}">${significant ? "Significant" : "Not significant"}</span></p>
    </div>`;
  }

  function renderCompare(compareMode, compare, compareDetail, primaryDetail, primaryRecord, compareRecord, variable) {
    els.compareSlot.hidden = !compareMode;
    if (!compareMode) {
      els.compareGrid.innerHTML = "";
      return;
    }
    if (!compare) {
      els.compareGrid.innerHTML = "";
      els.compareHint.hidden = false;
      return;
    }
    els.compareHint.hidden = true;
    els.compareGrid.innerHTML =
      compareCardMarkup(primaryRecord, primaryDetail, variable, true) +
      compareCardMarkup(compareRecord, compareDetail, variable, false);
  }

  async function show({ selection, variable, compare = null, compareMode = false }) {
    const request = ++token;
    lastArgs = { selection, variable, compare, compareMode };
    setLoading(variable);
    els.compareSlot.hidden = !compareMode;
    els.compareGrid.innerHTML = "";
    els.compareHint.hidden = Boolean(compare) || !compareMode;

    const needsLocations = selection.kind === "cell" || compare?.kind === "cell";
    if (needsLocations && !locationsPromise) {
      locationsPromise = loadCellLocations().catch((error) => {
        locationsPromise = null;
        throw error;
      });
    }
    let locations = null;
    if (needsLocations) {
      try {
        locations = await locationsPromise;
      } catch {
        locations = null;
      }
    }

    const detail = describe(selection, locations);
    const [records, compareRecords, compareDetail] = await Promise.all([
      loadRecords(selection),
      compare ? loadRecords(compare) : Promise.resolve(null),
      compare ? Promise.resolve(describe(compare, locations)) : Promise.resolve(null),
    ]);
    if (request !== token) return;

    els.type.textContent = `${detail.type} · ${VARIABLES[variable].label}`;
    els.title.textContent = detail.title;
    els.sub.textContent = detail.sub;

    const primaryRecord = recordFor(records, variable);
    const compareRecord = compareRecords ? recordFor(compareRecords, variable) : null;

    const primaryOk = primaryRecord && !primaryRecord.error && !primaryRecord.empty;
    if (!primaryOk) {
      const message = primaryRecord?.error
        ? "Check the connection and try again."
        : "No value was published for this location.";
      renderUnavailable(variable, primaryRecord?.empty ? "No value was published for this location." : message);
    } else {
      renderHeadline(primaryRecord, variable, detail, compareRecord, compareDetail);
    }

    renderCards(records, variable);
    renderCompare(compareMode, compare, compareDetail, detail, primaryRecord, compareRecord, variable);

    const chartsAvailable = await ensureCharts();
    if (request !== token) return;
    if (chartsAvailable) {
      if (primaryOk) renderChart(primaryRecord, detail, compareRecord, compareDetail);
      renderSparklines(records);
    } else if (primaryOk) {
      showChartError();
    }
  }

  return { show };
}
