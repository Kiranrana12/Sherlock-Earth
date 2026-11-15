// Chart.js wrappers for the annual series, fitted trend lines and card
// sparklines. Colors follow the project's chart palette, not the map scale.

import { CHART_COLORS } from "./config.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const liveCharts = new Set();
let defaultsApplied = false;

function styleVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value ? value.trim() : fallback;
}

export function cssVarColor(name, fallback) {
  return styleVar(name, fallback);
}

/** Chart colors come from the active CSS palette, not the map scale. */
export function readChartColors() {
  return {
    data: styleVar("--chart-data", CHART_COLORS.data),
    trend: styleVar("--chart-trend", CHART_COLORS.trend),
    compare: styleVar("--chart-compare", CHART_COLORS.compare),
    axis: styleVar("--chart-axis", CHART_COLORS.axis),
    grid: styleVar("--chart-grid", CHART_COLORS.grid),
    tooltipBg: styleVar("--chart-tooltip-bg", CHART_COLORS.tooltipBg),
    tooltipBorder: styleVar("--chart-tooltip-border", CHART_COLORS.tooltipBorder),
    tooltipText: styleVar("--chart-tooltip-text", CHART_COLORS.tooltipText),
  };
}

// Chart.js loads on first use. cdnjs is primary; jsDelivr serves the same
// pinned version when the primary host is unreachable.
const CHART_SOURCES = [
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
];
let chartPromise = null;

export function ensureCharts() {
  if (window.Chart) return Promise.resolve(true);
  if (!chartPromise) {
    chartPromise = new Promise((resolve) => {
      const load = (index) => {
        if (window.Chart) return resolve(true);
        if (index >= CHART_SOURCES.length) return resolve(false);
        const script = document.createElement("script");
        script.src = CHART_SOURCES[index];
        script.onload = () => (window.Chart ? resolve(true) : load(index + 1));
        script.onerror = () => load(index + 1);
        document.head.appendChild(script);
      };
      load(0);
    });
  }
  return chartPromise;
}

export function retryCharts() {
  chartPromise = null;
  return ensureCharts();
}

function applyDefaults() {
  if (defaultsApplied || !window.Chart) return;
  const { Chart } = window;
  const colors = readChartColors();
  Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
  Chart.defaults.font.size = 10;
  Chart.defaults.color = colors.axis;
  Chart.defaults.borderColor = colors.grid;
  Chart.defaults.animation = reducedMotion ? false : { duration: 420 };
  defaultsApplied = true;
}

/** Ordinary least squares through the annual series, used for the fit line. */
export function fitSeries(years, series) {
  const n = Math.min(years.length, series.length);
  if (n < 2) return null;
  const meanX = years.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = series.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (years[i] - meanX) * (series[i] - meanY);
    den += (years[i] - meanX) ** 2;
  }
  if (!den) return null;
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

function lineFor(years, fit) {
  return years.map((year) => fit.intercept + fit.slope * year);
}

function tickNumber(value) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function seriesDataset(record, label, color, { dashed = false, width = 1.7, point = 2.2 } = {}) {
  return {
    label,
    data: record.series,
    borderColor: color,
    backgroundColor: color,
    borderWidth: width,
    borderDash: dashed ? [5, 4] : [],
    pointRadius: point,
    pointHoverRadius: 4,
    pointBorderWidth: 0,
    pointBackgroundColor: color,
    tension: dashed ? 0 : 0.22,
    fill: false,
    units: record.seriesUnits,
    spanGaps: true,
  };
}

function fitDataset(record, label, color, years, fit) {
  return {
    label,
    data: lineFor(years, fit),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 1.5,
    borderDash: [4, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0,
    fill: false,
    units: record.seriesUnits,
  };
}

export function destroyChart(canvas) {
  const chart = canvas?._ttChart || (canvas && window.Chart?.getChart?.(canvas));
  if (chart) {
    liveCharts.delete(chart);
    chart.destroy();
    if (canvas._ttChart === chart) canvas._ttChart = null;
  }
}

function register(canvas, chart, profile) {
  chart.$ttProfile = profile;
  canvas._ttChart = chart;
  liveCharts.add(chart);
}

/** Repaint every live chart after the palette changes. */
export function refreshChartTheme() {
  if (!window.Chart) return;
  defaultsApplied = false;
  applyDefaults();
  const colors = readChartColors();

  for (const chart of liveCharts) {
    const profile = chart.$ttProfile;
    if (!profile) continue;

    if (profile.kind === "spark") {
      if (profile.variable) {
        const dataset = chart.data.datasets[0];
        const color = cssVarColor("--var-" + profile.variable, dataset.borderColor);
        dataset.borderColor = color;
        dataset.backgroundColor = color;
      }
    } else {
      for (const dataset of chart.data.datasets) {
        const color =
          dataset._ttRole === "trend"
            ? colors.trend
            : dataset._ttRole === "compare"
              ? colors.compare
              : colors.data;
        dataset.borderColor = color;
        dataset.backgroundColor = color;
        dataset.pointBackgroundColor = color;
      }
      const options = chart.options;
      options.scales.x.ticks.color = colors.axis;
      options.scales.y.ticks.color = colors.axis;
      options.scales.y.grid.color = colors.grid;
      options.scales.y.title.color = colors.axis;
      options.plugins.tooltip.backgroundColor = colors.tooltipBg;
      options.plugins.tooltip.borderColor = colors.tooltipBorder;
      options.plugins.tooltip.titleColor = colors.tooltipText;
      options.plugins.tooltip.bodyColor = colors.tooltipText;
    }
    chart.update("none");
  }
}

/**
 * Main annual-series chart.
 * `primary` and `compare` are records shaped { years, series, label, seriesUnits }.
 */
export function renderSeriesChart(canvas, { primary, primaryName, compare = null, compareName = "" }) {
  if (!window.Chart || !canvas || !primary?.series?.length) return null;
  applyDefaults();
  destroyChart(canvas);

  const years = primary.years;
  const colors = readChartColors();
  const datasets = [];
  const primaryFit = fitSeries(years, primary.series);

  const primaryData = seriesDataset({ ...primary, seriesUnits: primary.seriesUnits }, primaryName || "Annual value", colors.data);
  primaryData._ttRole = "data";
  datasets.push(primaryData);
  if (primaryFit) {
    const trendLine = fitDataset(primary, `${primaryName || "Annual value"} · linear fit`, colors.trend, years, primaryFit);
    trendLine._ttRole = "trend";
    datasets.push(trendLine);
  }

  if (compare?.series?.length) {
    const compareFit = fitSeries(compare.years, compare.series);
    const compareData = seriesDataset(compare, compareName || "Comparison", colors.compare, { point: 2 });
    compareData._ttRole = "compare";
    datasets.push(compareData);
    if (compareFit) {
      const compareTrend = fitDataset(compare, `${compareName || "Comparison"} · linear fit`, colors.compare, compare.years, compareFit);
      compareTrend._ttRole = "compare";
      datasets.push(compareTrend);
    }
  }

  const chart = new window.Chart(canvas, {
    type: "line",
    data: { labels: years.map(String), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          padding: 9,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            title: (items) => `Year ${items[0].label}`,
            label: (item) => {
              const units = item.dataset.units || "";
              return `${item.dataset.label}: ${tickNumber(item.parsed.y)} ${units}`.trim();
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: colors.axis, maxRotation: 0, autoSkip: false, font: { size: 8.5 }, padding: 3 },
        },
        y: {
          beginAtZero: false,
          grace: "12%",
          grid: { color: colors.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: colors.axis, padding: 6, maxTicksLimit: 5, callback: (value) => tickNumber(value), font: { size: 9.5 } },
          title: {
            display: Boolean(primary.seriesUnits),
            text: primary.seriesUnits || "",
            color: colors.axis,
            font: { size: 9 },
            padding: { bottom: 2 },
          },
        },
      },
    },
  });

  register(canvas, chart, { kind: "series" });
  return chart;
}

export function renderSparkline(canvas, { years, series, color, variable = "" }) {
  if (!window.Chart || !canvas || !series?.length) return null;
  applyDefaults();
  destroyChart(canvas);
  const chart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: years.map(String),
      datasets: [
        {
          data: series,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [],
      layout: { padding: { top: 2, bottom: 2 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, grace: "10%" } },
    },
  });
  register(canvas, chart, { kind: "spark", variable });
  return chart;
}
