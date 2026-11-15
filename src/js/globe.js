/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
// 3D globe: real Earth texture, baked borders, trend veil and significance dots.
// Everything drawn here is derived from the JSON files; the country raster is
// generated from countries.geojson by pipeline/render_borders.py.

import Globe from "globe.gl";
import { VARIABLES, SIGNIFICANCE_LEVEL } from "./config.js";
import { clear, loadTrends } from "./data.js";
import { buildTrendCanvas, buildLiveCanvas, cellIndex, indexCells } from "./heat.js";
import { createLabelLayer } from "./labels.js";
import { countryAt, ensureCountryLookup } from "./places.js";
import { BLUE_MARBLE_WMS_URL, gibsImageUrl } from "./live.js";
import { fmtSigned, nearestCell } from "./utils.js";

if (typeof window !== "undefined" && !window.Globe) {
  window.Globe = Globe;
}

const TEXTURES = {
  natural: "./assets/earth/earth-natural.jpg",
  data: "./assets/earth/earth-data.png",
  borders: "./assets/earth/borders.png",
};
const VEIL_RADIUS = 100.35;
const BORDER_RADIUS = 100.55;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function makeSolidEarthTexture(color = "#0d1527") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(163, 174, 203, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const y = (canvas.height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  for (let j = 1; j < 12; j += 1) {
    const x = (canvas.width / 12) * j;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:\/\//i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export function initGlobe({ container, stage, labelsContainer, onStatus, onSelect, onCompare, onCountryPick }) {
  let globe;
  try {
    globe = new Globe(container, {
      rendererConfig: { antialias: true, alpha: true, powerPreference: "high-performance" },
      animateIn: false,
    });
  } catch (error) {
    onStatus({ state: "error", text: "This browser could not start WebGL. The search and trend panels still work." });
    return null;
  }

  const initialWidth = stage.clientWidth || container.clientWidth || 560;
  const initialHeight = stage.clientHeight || container.clientHeight || 420;
  globe.width(initialWidth).height(initialHeight);

  const labels = createLabelLayer(labelsContainer);
  let sphere = null;
  let veil = null;
  let borderMesh = null;
  let three = null;
  let earthReady = false;
  let currentVariable = null;
  let currentData = null;
  let cellsByIndex = null;
  let requestToken = 0;
  let baseMode = "natural";
  let rotate = !reducedMotion;
  let pendingData = null;
  let pendingLive = null;
  let selected = null;
  let compareSelected = null;
  let pickMode = "primary";
  let countryMode = false;
  let liveMode = false;
  let liveValues = null;
  let liveCells = null;
  let liveDomain = 40;
  let gibsDate = null;

  const resolvedTextures = {
    natural: null,
    data: null,
  };

  async function getBaseTextureUrl(mode) {
    if (mode === "satellite") return gibsDate ? gibsImageUrl(gibsDate) : await getBaseTextureUrl("natural");
    if (mode === "data") {
      if (!resolvedTextures.data) {
        resolvedTextures.data = (await probeImage(TEXTURES.data))
          ? TEXTURES.data
          : makeSolidEarthTexture("#0d1527");
      }
      return resolvedTextures.data;
    }
    if (!resolvedTextures.natural) {
      if (await probeImage(TEXTURES.natural)) {
        resolvedTextures.natural = TEXTURES.natural;
      } else if (await probeImage(BLUE_MARBLE_WMS_URL)) {
        resolvedTextures.natural = BLUE_MARBLE_WMS_URL;
      } else {
        resolvedTextures.natural = makeSolidEarthTexture("#132642");
      }
    }
    return resolvedTextures.natural;
  }

  function markEarthReady() {
    if (!ensureLayers()) return false;
    earthReady = true;
    labelsContainer.hidden = false;
    const loading = document.getElementById("globe-loading");
    if (loading) loading.hidden = true;
    if (pendingData) {
      const { data, variable } = pendingData;
      pendingData = null;
      applyTrends(data, variable);
    } else if (pendingLive) {
      const { values, domain, cells } = pendingLive;
      pendingLive = null;
      setLive(values, domain, cells);
    }
    return true;
  }

  globe
    .backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#4cc9f0")
    .atmosphereAltitude(0.13)
    .globeImageUrl(makeSolidEarthTexture("#132642"))
    .pointLat("lat")
    .pointLng("lon")
    .pointColor(() => "rgba(232, 238, 248, 0.84)")
    .pointAltitude(0.012)
    .pointRadius(0.18)
    .pointResolution(7)
    .pointsMerge(true)
    .pointsTransitionDuration(0)
    .onGlobeClick(({ lat, lng }) => {
      if (countryMode) pickCountry(lat, lng);
      else selectAt(lat, lng);
    })
    .onGlobeReady(() => {
      markEarthReady();
    });

  // Fallback in case onGlobeReady fired before layers settled or texture probe finished
  let readyAttempts = 0;
  function checkReady() {
    if (earthReady || markEarthReady()) return;
    if (++readyAttempts < 90) requestAnimationFrame(checkReady);
  }
  requestAnimationFrame(checkReady);

  getBaseTextureUrl("natural").then((url) => {
    if (baseMode === "natural") globe.globeImageUrl(url);
  });

  const controls = globe.controls();
  controls.enablePan = false;
  controls.minDistance = 135;
  controls.maxDistance = 620;
  controls.autoRotate = rotate;
  controls.autoRotateSpeed = 0.32;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  globe.pointOfView({ lat: 22, lng: 6, altitude: 1.92 }, 0);

  function ensureLayers() {
    if (three && sphere) return true;
    globe.scene().traverse((object) => {
      const radius = object.geometry?.parameters?.radius;
      if (object.isMesh && object.material?.map && radius && radius <= 200) sphere = object;
    });
    if (!sphere?.material?.map) return false;
    const map = sphere.material.map;
    three = {
      Mesh: sphere.constructor,
      Sphere: sphere.geometry.constructor,
      Material: sphere.material.constructor,
      Texture: map.constructor,
      parent: sphere.parent,
    };

    const heatMaterial = new three.Material({
      map: null,
      transparent: true,
      depthWrite: false,
      side: 0,
      color: 0x000000,
      emissive: 0xffffff,
      emissiveIntensity: 1,
      shininess: 0,
    });
    veil = new three.Mesh(new three.Sphere(VEIL_RADIUS, 96, 48), heatMaterial);
    veil.rotation.copy(sphere.rotation);
    veil.renderOrder = 1;
    veil.visible = false;
    three.parent.add(veil);

    loadBorders();
    return true;
  }

  function makeTexture(source) {
    const texture = new three.Texture(source);
    texture.colorSpace = sphere.material.map.colorSpace;
    texture.anisotropy = sphere.material.map.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  function loadBorders() {
    const image = new Image();
    image.onload = () => {
      if (!three) return;
      const texture = makeTexture(image);
      const material = new three.Material({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: 0,
        color: 0x000000,
        emissive: 0x9db4d4,
        emissiveMap: texture,
        emissiveIntensity: 1,
        shininess: 0,
      });
      borderMesh = new three.Mesh(new three.Sphere(BORDER_RADIUS, 96, 48), material);
      borderMesh.rotation.copy(sphere.rotation);
      borderMesh.renderOrder = 2;
      three.parent.add(borderMesh);
    };
    image.src = TEXTURES.borders;
  }

  function setHeatTexture(canvas) {
    const texture = makeTexture(canvas);
    if (veil.material.map) veil.material.map.dispose();
    veil.material.map = texture;
    veil.material.emissiveMap = texture;
    veil.material.needsUpdate = true;
    veil.visible = true;
  }

  function clearHeatTexture() {
    if (!veil) return;
    if (veil.material.map) {
      veil.material.map.dispose();
      veil.material.map = null;
      veil.material.emissiveMap = null;
      veil.material.needsUpdate = true;
    }
    veil.visible = false;
  }

  function paintVeil() {
    const activeCells = currentData?.cells || liveCells;
    if (!veil || !activeCells) return 0;
    if (liveMode && liveValues) {
      const { canvas } = buildLiveCanvas(activeCells, liveValues, liveDomain, baseMode);
      setHeatTexture(canvas);
      globe.pointsData([]);
      return 0;
    }
    if (!currentData || !currentVariable) return 0;
    const { canvas, sigCount } = buildTrendCanvas(currentData.cells, VARIABLES[currentVariable], baseMode);
    setHeatTexture(canvas);
    globe.pointsData(currentData.cells.filter((cell) => Number(cell.p) < SIGNIFICANCE_LEVEL));
    return sigCount;
  }

  function applyTrends(data, variableName) {
    const variable = VARIABLES[variableName];
    if (!variable) return;
    if (!ensureLayers()) {
      pendingData = { data, variable: variableName };
      return;
    }

    currentVariable = variableName;
    currentData = data;
    cellsByIndex = indexCells(data.cells);

    const sigCount = paintVeil();

    const chip = document.getElementById("sig-count");
    if (chip) {
      chip.textContent = liveMode && liveValues
        ? `${liveValues.size.toLocaleString("en-US")} live`
        : `${sigCount.toLocaleString("en-US")} sig`;
    }
    if (liveMode && liveValues) {
      onStatus({
        state: "ready",
        text: `${liveValues.size.toLocaleString("en-US")} cells painted with live Open-Meteo temperature · trend significance hidden`,
      });
    } else {
      onStatus({
        state: "ready",
        text: `${data.cells.length.toLocaleString("en-US")} cells · ${sigCount.toLocaleString("en-US")} significant (p < ${SIGNIFICANCE_LEVEL}) · ${variable.years}`,
      });
    }

    if (selected || compareSelected) updateSelectionMarkers();
  }

  function findCell(lat, lng) {
    if (currentData?.cells?.length) {
      const direct = cellsByIndex?.get(cellIndex(lat, lng));
      if (direct) return direct;
      return nearestCell(currentData.cells, lat, lng);
    }
    const wrappedLon = ((((Number(lng) + 180) % 360) + 360) % 360) - 180;
    const row = Math.min(35, Math.max(0, Math.floor((lat + 90) / 5)));
    const col = Math.min(71, Math.max(0, Math.floor((wrappedLon + 180) / 5)));
    return {
      lat: -87.5 + row * 5,
      lon: -177.5 + col * 5,
      slope: NaN,
      p: NaN,
    };
  }

  function selectAt(lat, lng) {
    const cell = findCell(lat, lng);
    if (!cell) return;
    const clickPoint = { lat, lon: lng };

    if (pickMode === "compare") {
      if (selected && cell.lat === selected.lat && cell.lon === selected.lon) return;
      compareSelected = cell;
      positionMarker(compareMarker, compareSelected);
      const compareVariable = VARIABLES[currentVariable];
      onCompare?.(cell, currentVariable, clickPoint);
      onStatus({
        state: "ready",
        text: Number.isFinite(cell.slope)
          ? `Comparison cell at ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}° · ${fmtSigned(cell.slope, compareVariable.decimals)} ${compareVariable.units} · p = ${cell.p.toFixed(4)}`
          : `Comparison cell at ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°`,
      });
      return;
    }

    selected = cell;
    updateSelectionMarkers();
    const variable = VARIABLES[currentVariable];
    if (Number.isFinite(cell.slope) && variable) {
      const direction = cell.slope >= 0 ? variable.increase : variable.decrease;
      onStatus({
        state: "ready",
        text: `Selected 5° cell at ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}° · ${fmtSigned(cell.slope, variable.decimals)} ${variable.units} · p = ${cell.p.toFixed(4)} · ${direction}`,
      });
    } else {
      onStatus({
        state: "ready",
        text: `Selected 5° cell at ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}°`,
      });
    }
    onSelect?.(cell, currentVariable, clickPoint);
  }

  function setPickMode(mode) {
    pickMode = mode === "compare" ? "compare" : "primary";
    return pickMode;
  }

  function setCompareCell(cell) {
    compareSelected = cell || null;
    updateSelectionMarkers();
    return compareSelected;
  }

  async function pickCountry(lat, lng) {
    try {
      await ensureCountryLookup();
    } catch (error) {
      onStatus({
        state: "error",
        text: `Country outlines could not load. ${error.message}`,
      });
      return;
    }
    const country = countryAt(lat, lng);
    if (!country) {
      onStatus({
        state: "ready",
        text: "No country at that point — that is open ocean. Click a land area.",
      });
      return;
    }
    onCountryPick?.(country, lat, lng);
  }

  async function setCountryMode(on) {
    const next = Boolean(on);
    if (next) {
      try {
        await ensureCountryLookup();
      } catch (error) {
        onStatus({
          state: "error",
          text: `Country outlines could not load. ${error.message}`,
        });
        return false;
      }
    }
    countryMode = next;
    return true;
  }

  function setExternalSelection(point, { fly = false, altitude = 1.55 } = {}) {
    selected = point ? { lat: Number(point.lat), lon: Number(point.lon) } : null;
    updateSelectionMarkers();
    if (selected && fly) flyTo(selected.lat, selected.lon, altitude);
  }

  function setExternalCompare(point, { fly = false, altitude = 1.55 } = {}) {
    compareSelected = point ? { lat: Number(point.lat), lon: Number(point.lon) } : null;
    updateSelectionMarkers();
    if (compareSelected && fly) flyTo(compareSelected.lat, compareSelected.lon, altitude);
  }

  async function setVariable(name, { force = false } = {}) {
    const variable = VARIABLES[name];
    if (!variable) return;
    currentVariable = name;
    const token = ++requestToken;
    onStatus({ state: "loading", text: `Loading ${variable.label.toLowerCase()} trend cells…` });
    if (force) clear(`trends:${name}`);

    try {
      const data = await loadTrends(name);
      if (token !== requestToken) return;
      if (!earthReady) {
        pendingData = { data, variable: name };
        return;
      }
      applyTrends(data, name);
    } catch (error) {
      if (token !== requestToken) return;
      currentData = null;
      cellsByIndex = null;
      if (!liveMode) clearHeatTexture();
      globe.pointsData([]);
      const chip = document.getElementById("sig-count");
      if (chip && !liveMode) chip.textContent = "No data";
      onStatus({
        state: "error",
        text: `${variable.label} trend data could not load. ${error.message}`,
        retry: true,
      });
    }
  }

  async function setBase(mode, satelliteDate = null) {
    if (satelliteDate) gibsDate = satelliteDate;
    baseMode = mode === "data" || mode === "satellite" ? mode : "natural";
    const url = await getBaseTextureUrl(baseMode);
    globe.globeImageUrl(url);
    paintVeil();
    return baseMode;
  }

  function setLive(values, domain, fallbackCells = null) {
    liveMode = true;
    liveValues = values || null;
    liveCells = fallbackCells || liveCells;
    liveDomain = Number.isFinite(domain) ? domain : liveDomain;
    if (!ensureLayers()) {
      pendingLive = { values, domain, cells: fallbackCells };
      return liveMode;
    }
    if (currentData && currentVariable) {
      applyTrends(currentData, currentVariable);
    } else if (liveCells && liveValues) {
      paintVeil();
      const chip = document.getElementById("sig-count");
      if (chip) chip.textContent = `${liveValues.size.toLocaleString("en-US")} live`;
    }
    return liveMode;
  }

  function clearLive() {
    liveMode = false;
    liveValues = null;
    pendingLive = null;
    if (currentData && currentVariable) {
      applyTrends(currentData, currentVariable);
    } else {
      clearHeatTexture();
      const chip = document.getElementById("sig-count");
      if (chip) chip.textContent = "No data";
    }
    return liveMode;
  }

  function setRotation(on) {
    rotate = Boolean(on);
    controls.autoRotate = rotate;
    return rotate;
  }

  function toggleRotation() {
    return setRotation(!rotate);
  }

  function setLabels(visible) {
    labels.setVisible(Boolean(visible));
  }

  function flyTo(lat, lon, altitude = 1.55) {
    globe.pointOfView({ lat, lng: lon, altitude }, 900);
  }

  function resetView() {
    globe.pointOfView({ lat: 22, lng: 6, altitude: 1.92 }, 800);
  }

  function reload() {
    if (!currentVariable) return;
    setVariable(currentVariable, { force: true });
  }

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      globe.width(stage.clientWidth).height(stage.clientHeight);
      labels.update(globe);
    });
    observer.observe(stage);
    stage._observer = observer;
  }

  const selectionMarker = document.getElementById("globe-selection");
  const compareMarker = document.getElementById("globe-compare-selection");

  function positionMarker(marker, cell) {
    if (!marker) return;
    if (!cell || !three) {
      marker.hidden = true;
      return;
    }
    const camera = globe.camera().position;
    const coords = globe.getCoords(cell.lat, cell.lon, 0.012);
    const facing = coords.x * camera.x + coords.y * camera.y + coords.z * camera.z;
    if (facing <= globe.getGlobeRadius() ** 2 * 1.002) {
      marker.hidden = true;
      return;
    }
    const screen = globe.getScreenCoords(cell.lat, cell.lon, 0.012);
    marker.hidden = false;
    marker.style.left = `${screen.x.toFixed(1)}px`;
    marker.style.top = `${screen.y.toFixed(1)}px`;
  }

  function updateSelectionMarkers() {
    positionMarker(selectionMarker, selected);
    positionMarker(compareMarker, compareSelected);
  }

  let lastCam = [0, 0, 0];
  let lastSize = [0, 0];
  function tick() {
    const camera = globe.camera();
    const p = camera.position;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (
      Math.abs(p.x - lastCam[0]) > 0.05 ||
      Math.abs(p.y - lastCam[1]) > 0.05 ||
      Math.abs(p.z - lastCam[2]) > 0.05 ||
      lastSize[0] !== width ||
      lastSize[1] !== height
    ) {
      labels.update(globe);
      updateSelectionMarkers();
      lastCam = [p.x, p.y, p.z];
      lastSize = [width, height];
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    setVariable,
    setBase,
    setLive,
    clearLive,
    setRotation,
    toggleRotation,
    setLabels,
    setPickMode,
    setCompareCell,
    setCountryMode,
    setExternalSelection,
    setExternalCompare,
    flyTo,
    resetView,
    reload,
    getBase: () => baseMode,
    getLive: () => liveMode,
    getCells: () => (currentData ? currentData.cells : null),
    getRotation: () => rotate,
    getCountryMode: () => countryMode,
    isReady: () => earthReady,
  };
}
