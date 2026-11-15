/**
 * TerraTrend: NASA Earth System Trend Detective
 * Frontend Application Engine
 * NASA Space Apps Challenge 2026
 * Earth-Teal Theme (#237b75, #54aba1, #afefd4, #fff8b2)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. STATE & CONFIGURATION
  // =========================================================================

  const CONFIG = {
    dataDir: 'data',
    variables: {
      temperature: {
        id: 'temperature',
        name: 'Near-Surface Air Temperature',
        shortName: 'Temperature',
        unit: '°C / year',
        seriesUnit: '°C',
        colorScale: 'coolwarm',
        min: -0.25,
        max: 0.25,
        anomalyMin: -2.0,
        anomalyMax: 2.0,
        positiveMeaning: 'Warming',
        negativeMeaning: 'Cooling',
        accentColor: '#f87171'
      },
      precipitation: {
        id: 'precipitation',
        name: 'Total Precipitation',
        shortName: 'Precipitation',
        unit: 'mm / year²',
        seriesUnit: 'mm / year',
        colorScale: 'precip',
        min: -50.0,
        max: 50.0,
        anomalyMin: -300.0,
        anomalyMax: 300.0,
        positiveMeaning: 'Wetting / Greening',
        negativeMeaning: 'Drying / Drought',
        accentColor: '#54aba1'
      },
      humidity: {
        id: 'humidity',
        name: '2-Meter Specific Humidity',
        shortName: 'Specific Humidity',
        unit: 'g/kg / year',
        seriesUnit: 'g/kg',
        colorScale: 'humidity',
        min: -0.06,
        max: 0.08,
        anomalyMin: -1.0,
        anomalyMax: 1.0,
        positiveMeaning: 'Moistening',
        negativeMeaning: 'Drying',
        accentColor: '#afefd4'
      },
      wind: {
        id: 'wind',
        name: '10-Meter Mean Wind-Vector Magnitude',
        shortName: 'Wind Speed',
        unit: 'm/s / year',
        seriesUnit: 'm/s',
        colorScale: 'wind',
        min: -0.06,
        max: 0.06,
        anomalyMin: -0.6,
        anomalyMax: 0.6,
        positiveMeaning: 'Strengthening',
        negativeMeaning: 'Stilling / Weakening',
        accentColor: '#fff8b2'
      }
    },
    basemaps: {
      satellite: {
        name: 'Real Satellite (Earth Photo)',
        base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      },
      physical: {
        name: 'Physical & Countries (Voyager)',
        base: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'
      },
      dark: {
        name: 'Dark Orbit Canvas',
        base: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'
      },
      topo: {
        name: 'Shaded Topography',
        base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
        labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS'
      }
    },
    regionBounds: {
      'Global': { lat_min: -90, lat_max: 90, lon_min: -180, lon_max: 180 },
      'Amazon Basin': { lat_min: -15, lat_max: 5, lon_min: -75, lon_max: -50 },
      'Sahel': { lat_min: 10, lat_max: 18, lon_min: -15, lon_max: 40 },
      'South Asia': { lat_min: 8, lat_max: 35, lon_min: 65, lon_max: 95 },
      'Arctic': { lat_min: 66, lat_max: 90, lon_min: -180, lon_max: 180 },
      'Southeast Asia': { lat_min: -10, lat_max: 20, lon_min: 95, lon_max: 140 },
      'Mediterranean': { lat_min: 30, lat_max: 45, lon_min: -10, lon_max: 40 }
    }
  };

  const state = {
    activeTab: 'map-tab',
    activeVar: 'temperature',
    topTrendsActiveVar: 'temperature',
    viewMode: 'trend', // 'trend' or 'anomaly'
    activeAnomalyYear: 2024,
    activeBasemap: 'satellite',
    gridOpacity: 0.55,
    sigOnly: false,
    selectedCell: null,
    selectedRegion: 'Global',
    compareWithGlobal: false,

    // Data Cache
    regionsData: null,
    topTrendsData: null,
    countriesIndex: [],
    countriesGeoJSON: null,
    cellLocations: {},
    trendsDataCache: {}, // { temperature: {...}, ... }

    // Map & Layers
    map: null,
    baseTileLayer: null,
    labelsTileLayer: null,
    canvasRenderer: null,
    gridLayerGroup: null,
    countryBordersLayer: null,
    regionLayerGroup: null,
    selectionMarker: null,
    chartInstance: null,

    // Animation timer
    isPlayingYears: false,
    playInterval: null
  };

  // =========================================================================
  // 2. GEOGRAPHIC & COUNTRY LOOKUP HELPERS
  // =========================================================================

  function getCellLocationInfo(lat, lon) {
    const key = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
    if (state.cellLocations && state.cellLocations[key]) {
      return state.cellLocations[key];
    }

    const coordStr = formatCoord(lat, lon);
    if (lat >= 66) return { country: 'Arctic Ocean', continent: 'Polar', label: 'Arctic Ocean', is_land: false };
    if (lat <= -60) return { country: 'Antarctica', continent: 'Antarctica', label: 'Antarctica', is_land: true };
    return { country: null, continent: 'World', label: `Grid Cell (${coordStr})`, is_land: false };
  }

  function pointInRing(lat, lon, ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const currentLon = ((ring[i][0] - lon + 540) % 360) - 180;
      const previousLon = ((ring[j][0] - lon + 540) % 360) - 180;
      const currentLat = ring[i][1] - lat;
      const previousLat = ring[j][1] - lat;
      const crossesPointLatitude = (currentLat > 0) !== (previousLat > 0);
      const crossingLon = currentLon +
        ((previousLon - currentLon) * -currentLat) / (previousLat - currentLat);

      if (crossesPointLatitude && crossingLon > 0) inside = !inside;
    }

    return inside;
  }

  function getPointLocationInfo(latlng, cell) {
    const features = (state.countriesGeoJSON && state.countriesGeoJSON.features) || [];

    for (const feature of features) {
      const geometry = feature.geometry;
      if (!geometry) continue;

      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];

      const containsPoint = polygons.some((rings) =>
        pointInRing(latlng.lat, latlng.lng, rings[0]) &&
        !rings.slice(1).some((ring) => pointInRing(latlng.lat, latlng.lng, ring))
      );

      if (containsPoint) {
        const properties = feature.properties || {};
        const country = properties.NAME || properties.ADMIN;
        const continent = properties.CONTINENT || '';
        return { country, continent, label: `${country} (${continent})`, is_land: true };
      }
    }

    const cellLocation = getCellLocationInfo(cell.lat, cell.lon);
    if (cellLocation.is_land) {
      return { country: null, continent: 'World', label: 'Ocean Grid Cell', is_land: false };
    }
    return cellLocation;
  }

  function formatCoord(lat, lon) {
    const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    return `${latStr}, ${lonStr}`;
  }

  function formatSlope(slope, varId) {
    if (slope === undefined || slope === null || isNaN(slope)) return 'N/A';
    const sign = slope > 0 ? '+' : '';
    const decimals = (varId === 'precipitation') ? 2 : (varId === 'wind' || varId === 'humidity') ? 4 : 3;
    return `${sign}${slope.toFixed(decimals)}`;
  }

  function formatPValue(p) {
    if (p === undefined || p === null || isNaN(p)) return 'N/A';
    if (p < 0.0001) return '< 0.0001';
    return p.toFixed(4);
  }

  // =========================================================================
  // 3. COLOR SCALES & INTERPOLATION (Cohesive Earth-Teal Divergence)
  // =========================================================================

  function interpolateColor(c1, c2, t) {
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function getColorForValue(val, varId, isAnomaly = false) {
    const cfg = CONFIG.variables[varId];
    const minVal = isAnomaly ? cfg.anomalyMin : cfg.min;
    const maxVal = isAnomaly ? cfg.anomalyMax : cfg.max;

    if (val === undefined || val === null || isNaN(val)) return 'rgba(35, 123, 117, 0.35)';

    // Diverging Color Palettes harmonized with the User's Palette
    // Negative (cool/drying/cooling): Deep Teal -> Seafoam -> Neutral
    // Positive (warm/wetting/warming): Neutral -> Soft Cream Gold -> Warm Coral
    const cDeepTeal = [35, 123, 117];    // #237b75
    const cSeafoam = [84, 171, 161];     // #54aba1
    const cMint = [175, 239, 212];       // #afefd4
    const cNeutral = [16, 45, 42];       // Deep pine center
    const cCreamGold = [255, 248, 178];  // #fff8b2
    const cWarmAmber = [245, 158, 11];   // Warm gold
    const cCoral = [248, 113, 113];      // Soft coral red

    let cNegFar, cNegNear, cPosNear, cPosFar;

    if (varId === 'temperature') {
      cNegFar = cDeepTeal;
      cNegNear = cSeafoam;
      cPosNear = cCreamGold;
      cPosFar = cCoral;
    } else if (varId === 'precipitation' || varId === 'humidity') {
      cNegFar = [161, 98, 7];        // Amber brown for drying
      cNegNear = cCreamGold;
      cPosNear = cSeafoam;
      cPosFar = cMint;
    } else {
      // wind
      cNegFar = [126, 34, 206];
      cNegNear = cSeafoam;
      cPosNear = cCreamGold;
      cPosFar = [234, 179, 8];
    }

    if (val < 0) {
      const t = Math.min(1, Math.max(0, Math.abs(val) / Math.abs(minVal)));
      if (t < 0.5) {
        return interpolateColor(cNeutral, cNegNear, t * 2);
      } else {
        return interpolateColor(cNegNear, cNegFar, (t - 0.5) * 2);
      }
    } else {
      const t = Math.min(1, Math.max(0, val / maxVal));
      if (t < 0.5) {
        return interpolateColor(cNeutral, cPosNear, t * 2);
      } else {
        return interpolateColor(cPosNear, cPosFar, (t - 0.5) * 2);
      }
    }
  }

  // =========================================================================
  // 4. DATA FETCHING
  // =========================================================================

  async function loadJSON(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      console.warn(`Failed loading JSON from ${url}:`, err);
      if (window.location.protocol === 'file:') {
        const warnBanner = document.getElementById('protocol-warning');
        if (warnBanner) warnBanner.classList.remove('hidden');
      }
      throw err;
    }
  }

  async function ensureTrendsData(varId) {
    if (state.trendsDataCache[varId]) {
      return state.trendsDataCache[varId];
    }
    const loader = document.getElementById('map-loader');
    if (loader) loader.classList.remove('hidden');

    try {
      const data = await loadJSON(`${CONFIG.dataDir}/trends_${varId}.json`);
      state.trendsDataCache[varId] = data;
      return data;
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  }

  // =========================================================================
  // 5. LEAFLET MAP INITIALIZATION & REAL-WORLD BASEMAPS
  // =========================================================================

  function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || state.map) return;

    state.map = L.map('map', {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      maxZoom: 10,
      worldCopyJump: true,
      zoomControl: true
    });

    // Custom Panes:
    // Tiles: zIndex 200
    // Climate: zIndex 450
    // Countries: zIndex 500
    // Labels: zIndex 650 (topmost)
    state.map.createPane('climatePane');
    state.map.getPane('climatePane').style.zIndex = 450;

    state.map.createPane('countriesPane');
    state.map.getPane('countriesPane').style.zIndex = 500;

    state.map.createPane('labelsPane');
    state.map.getPane('labelsPane').style.zIndex = 650;
    state.map.getPane('labelsPane').style.pointerEvents = 'none';

    applyBasemap(state.activeBasemap);

    state.canvasRenderer = L.canvas({
      pane: 'climatePane',
      padding: 0.5
    });

    state.gridLayerGroup = L.layerGroup().addTo(state.map);
    state.regionLayerGroup = L.layerGroup().addTo(state.map);

    state.map.on('click', function (e) {
      if (state.activeTab !== 'map-tab') return;
      handleMapClick(e.latlng);
    });

    drawRegionBoundaries();
  }

  function applyBasemap(styleKey) {
    if (!state.map) return;
    const cfg = CONFIG.basemaps[styleKey] || CONFIG.basemaps.satellite;

    if (state.baseTileLayer) state.map.removeLayer(state.baseTileLayer);
    if (state.labelsTileLayer) state.map.removeLayer(state.labelsTileLayer);

    state.baseTileLayer = L.tileLayer(cfg.base, {
      attribution: cfg.attribution,
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(state.map);

    if (cfg.labels) {
      state.labelsTileLayer = L.tileLayer(cfg.labels, {
        pane: 'labelsPane',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(state.map);
    }
  }

  function renderCountryBoundaries() {
    if (!state.map || !state.countriesGeoJSON) return;

    if (state.countryBordersLayer) {
      state.map.removeLayer(state.countryBordersLayer);
      state.countryBordersLayer = null;
    }

    state.countryBordersLayer = L.geoJSON(state.countriesGeoJSON, {
      pane: 'countriesPane',
      style: {
        color: 'rgba(175, 239, 212, 0.45)',
        weight: 1.0,
        fill: false
      },
      onEachFeature: function (feature, layer) {
        const name = feature.properties.NAME || feature.properties.ADMIN;
        const continent = feature.properties.CONTINENT || '';

        layer.bindTooltip(`<b>📍 ${name}</b> <span style="opacity:0.8;font-size:11px;">(${continent})</span>`, {
          sticky: true,
          direction: 'auto',
          className: 'custom-country-tooltip'
        });

        layer.on({
          mouseover: function (e) {
            e.target.setStyle({
              color: '#fff8b2',
              weight: 2.2
            });
            e.target.bringToFront();
          },
          mouseout: function (e) {
            state.countryBordersLayer.resetStyle(e.target);
          },
          click: function (e) {
            L.DomEvent.stopPropagation(e);
            state.map.fitBounds(layer.getBounds(), { padding: [35, 35], maxZoom: 6 });
            handleMapClick(e.latlng);
          }
        });
      }
    }).addTo(state.map);
  }

  function drawRegionBoundaries() {
    state.regionLayerGroup.clearLayers();
    const regions = CONFIG.regionBounds;

    for (const [name, bounds] of Object.entries(regions)) {
      if (name === 'Global') continue;

      const rect = L.rectangle(
        [[bounds.lat_min, bounds.lon_min], [bounds.lat_max, bounds.lon_max]],
        {
          pane: 'countriesPane',
          color: '#afefd4',
          weight: 2.0,
          dashArray: '5, 5',
          fill: false,
          interactive: true
        }
      );

      rect.bindTooltip(`<b>Study Zone: ${name}</b><br>Click to focus diagnostics`, {
        permanent: false,
        direction: 'center',
        className: 'custom-cell-tooltip'
      });

      rect.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        focusRegion(name);
      });

      state.regionLayerGroup.addLayer(rect);
    }
  }

  function renderGridCells() {
    if (!state.map || !state.trendsDataCache[state.activeVar]) return;
    const data = state.trendsDataCache[state.activeVar];
    const cells = data.cells || [];
    const varCfg = CONFIG.variables[state.activeVar];
    const years = data.years || [];

    state.gridLayerGroup.clearLayers();

    let sigCount = 0;
    const isAnomalyMode = state.viewMode === 'anomaly';
    const yearIndex = years.indexOf(state.activeAnomalyYear);
    const baseOpacity = state.gridOpacity;

    cells.forEach((cell) => {
      const isSig = cell.p < 0.05;
      if (isSig) sigCount++;

      if (state.sigOnly && !isSig) return;

      let displayVal;
      if (isAnomalyMode && yearIndex !== -1 && cell.series && cell.series[yearIndex] !== undefined) {
        const mean = cell.series.reduce((a, b) => a + b, 0) / cell.series.length;
        displayVal = cell.series[yearIndex] - mean;
      } else {
        displayVal = cell.slope;
      }

      const color = getColorForValue(displayVal, state.activeVar, isAnomalyMode);
      const fillOpacity = isSig ? baseOpacity : (state.sigOnly ? 0 : Math.max(0.12, baseOpacity * 0.35));
      const strokeColor = isSig ? color : 'rgba(175,239,212,0.08)';

      const lat = cell.lat;
      const lon = cell.lon;
      const bounds = [
        [Math.max(-90, lat - 2.5), Math.max(-180, lon - 2.5)],
        [Math.min(90, lat + 2.5), Math.min(180, lon + 2.5)]
      ];

      const rect = L.rectangle(bounds, {
        renderer: state.canvasRenderer,
        pane: 'climatePane',
        fillColor: color,
        fillOpacity: fillOpacity,
        color: strokeColor,
        weight: isSig ? 0.75 : 0.25,
        interactive: true
      });

      const loc = getCellLocationInfo(lat, lon);
      const coordLabel = formatCoord(lat, lon);
      const slopeLabel = formatSlope(cell.slope, state.activeVar);
      const pLabel = formatPValue(cell.p);
      const sigBadge = isSig ? '<span style="color:#afefd4;font-weight:700;">✓ Significant (p < 0.05)</span>' : '<span style="color:#83b3ad;">⚠ Indeterminate (p ≥ 0.05)</span>';
      const countryLine = loc.country ? `<div style="color:#fff8b2;font-weight:700;font-size:13px;margin-bottom:2px;">📍 ${loc.country} <span style="font-size:11px;font-weight:400;color:#afefd4;">(${loc.continent})</span></div>` : `<div style="color:#54aba1;font-weight:700;font-size:13px;margin-bottom:2px;">🌊 ${loc.label}</div>`;

      const tooltipContent = `
        ${countryLine}
        <div style="font-family:monospace;color:#83b3ad;font-size:11px;margin-bottom:4px;">${coordLabel}</div>
        <div style="font-family:monospace;font-size:12px;margin-bottom:3px;color:#fff;">
          <strong>Rate:</strong> ${slopeLabel} ${varCfg.unit}
        </div>
        <div style="font-family:monospace;font-size:11px;margin-bottom:4px;color:#83b3ad;">
          <strong>p-value:</strong> ${pLabel}
        </div>
        <div>${sigBadge}</div>
      `;

      rect.bindTooltip(tooltipContent, {
        sticky: true,
        direction: 'auto',
        className: 'custom-cell-tooltip'
      });

      rect.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectCell(cell, e.latlng);
      });

      state.gridLayerGroup.addLayer(rect);
    });

    const badge = document.getElementById('sig-count-badge');
    if (badge) {
      const pct = ((sigCount / cells.length) * 100).toFixed(1);
      badge.textContent = `${sigCount} / ${cells.length} (${pct}%)`;
    }

    if (state.selectedCell) {
      drawSelectionTarget(state.selectedCell.lat, state.selectedCell.lon);
    }

    updateLegend();
  }

  function drawSelectionTarget(lat, lon) {
    if (state.selectionMarker) {
      state.map.removeLayer(state.selectionMarker);
      state.selectionMarker = null;
    }

    const bounds = [
      [lat - 2.5, lon - 2.5],
      [lat + 2.5, lon + 2.5]
    ];

    state.selectionMarker = L.rectangle(bounds, {
      pane: 'countriesPane',
      color: '#fff8b2',
      weight: 3.5,
      fillColor: 'transparent',
      dashArray: '5, 5',
      interactive: false
    }).addTo(state.map);
  }

  function handleMapClick(latlng) {
    if (!state.trendsDataCache[state.activeVar]) return;
    const cells = state.trendsDataCache[state.activeVar].cells || [];
    if (!cells.length) return;

    const cellContainingPoint = cells.find((cell) => {
      const latDistance = Math.abs(cell.lat - latlng.lat);
      const lonDistance = Math.abs(((cell.lon - latlng.lng + 540) % 360) - 180);
      return latDistance <= 2.5 && lonDistance <= 2.5;
    });

    if (cellContainingPoint) {
      selectCell(cellContainingPoint, latlng);
      return;
    }

    let nearest = null;
    let minDist = Infinity;

    for (const cell of cells) {
      const dLat = cell.lat - latlng.lat;
      const dLon = ((cell.lon - latlng.lng + 540) % 360) - 180;
      const dist = dLat * dLat + dLon * dLon;
      if (dist < minDist) {
        minDist = dist;
        nearest = cell;
      }
    }

    if (nearest && minDist < 60) {
      selectCell(nearest, latlng);
    }
  }

  function updateLegend() {
    const varCfg = CONFIG.variables[state.activeVar];
    const isAnomaly = state.viewMode === 'anomaly';

    const titleEl = document.getElementById('legend-title');
    const periodEl = document.getElementById('legend-period');
    const barEl = document.getElementById('legend-bar');
    const minEl = document.getElementById('legend-min');
    const zeroEl = document.getElementById('legend-zero');
    const maxEl = document.getElementById('legend-max');

    const years = (state.trendsDataCache[state.activeVar] && state.trendsDataCache[state.activeVar].years) || [2014, 2025];
    const periodStr = `${years[0]}–${years[years.length - 1]}`;

    if (isAnomaly) {
      titleEl.textContent = `Annual Anomaly (${state.activeAnomalyYear}) [${varCfg.seriesUnit}]`;
      periodEl.textContent = `Relative to ${periodStr} Mean`;
      minEl.textContent = `${varCfg.anomalyMin}`;
      zeroEl.textContent = '0.00';
      maxEl.textContent = `+${varCfg.anomalyMax}`;
    } else {
      titleEl.textContent = `${varCfg.shortName} Trend [${varCfg.unit}]`;
      periodEl.textContent = periodStr;
      minEl.textContent = `${varCfg.min}`;
      zeroEl.textContent = '0.00';
      maxEl.textContent = `+${varCfg.max}`;
    }

    // Cohesive Earth-Teal / Warm-Cream Legend Bar
    if (varCfg.colorScale === 'precip' || varCfg.colorScale === 'humidity') {
      barEl.style.background = 'linear-gradient(90deg, #a16207 0%, #fff8b2 30%, #102d2a 50%, #54aba1 75%, #afefd4 100%)';
    } else if (varCfg.colorScale === 'wind') {
      barEl.style.background = 'linear-gradient(90deg, #7e22ce 0%, #54aba1 30%, #102d2a 50%, #fff8b2 75%, #eab308 100%)';
    } else {
      // temperature
      barEl.style.background = 'linear-gradient(90deg, #237b75 0%, #54aba1 30%, #102d2a 50%, #fff8b2 75%, #f87171 100%)';
    }
  }

  // =========================================================================
  // 6. INSPECTOR PANEL & TIME SERIES CHART
  // =========================================================================

  function selectCell(cell, clickedPoint = null) {
    state.selectedCell = cell;
    drawSelectionTarget(cell.lat, cell.lon);

    const varCfg = CONFIG.variables[state.activeVar];
    const loc = clickedPoint
      ? getPointLocationInfo(clickedPoint, cell)
      : getCellLocationInfo(cell.lat, cell.lon);
    const coordsStr = formatCoord(cell.lat, cell.lon);
    const years = (state.trendsDataCache[state.activeVar] && state.trendsDataCache[state.activeVar].years) || [2014, 2025];
    const numYears = years.length;

    // Prominent Header & Country info
    document.getElementById('inspector-title').textContent = loc.country || loc.label;
    document.getElementById('inspector-badge').textContent = loc.is_land ? 'Land Cell' : 'Ocean Cell';
    document.getElementById('cell-country-name').textContent = loc.country ? `${loc.country} (${loc.continent})` : loc.label;
    document.getElementById('cell-coords').textContent = coordsStr;
    document.getElementById('cell-geo-name').textContent = `NASA MERRA-2 5°×5° Grid`;

    // Slope & Arrow
    const slopeValEl = document.getElementById('cell-slope');
    const slopeArrowEl = document.getElementById('cell-trend-arrow');
    const slopeUnitEl = document.getElementById('cell-unit');

    slopeValEl.textContent = formatSlope(cell.slope, state.activeVar);
    slopeArrowEl.textContent = cell.slope > 0 ? '↗' : (cell.slope < 0 ? '↘' : '→');
    slopeArrowEl.style.color = cell.slope > 0 ? '#fff8b2' : '#afefd4';
    slopeUnitEl.textContent = varCfg.unit;

    // p-value & Verdict
    const pValEl = document.getElementById('cell-p');
    const verdictEl = document.getElementById('cell-verdict');
    pValEl.textContent = formatPValue(cell.p);

    if (cell.p < 0.05) {
      verdictEl.className = 'verdict-chip chip-significant';
      verdictEl.textContent = 'Statistically Significant (p < 0.05)';
    } else {
      verdictEl.className = 'verdict-chip chip-indeterminate';
      verdictEl.textContent = 'Indeterminate (p ≥ 0.05)';
    }

    // Baseline Mean & Net Change
    const mean = (cell.series && cell.series.length) ? (cell.series.reduce((a, b) => a + b, 0) / cell.series.length) : 0;
    const netChange = cell.slope * (numYears - 1);

    document.getElementById('cell-baseline').textContent = mean.toFixed(2);
    document.getElementById('cell-baseline-unit').textContent = varCfg.seriesUnit;
    document.getElementById('cell-net-change').textContent = (netChange > 0 ? '+' : '') + netChange.toFixed(2);
    document.getElementById('cell-net-unit').textContent = `${varCfg.seriesUnit} over ${numYears} yrs`;

    // Synthesis Sentence with Country
    const synthesisEl = document.getElementById('cell-summary-text');
    const trendWord = cell.slope > 0 ? varCfg.positiveMeaning.toLowerCase() : varCfg.negativeMeaning.toLowerCase();
    const sigWord = cell.p < 0.05 ? 'statistically significant at the p < 0.05 threshold' : 'not statistically significant under ordinary linear regression';
    const placeWord = loc.country ? `in ${loc.country} (${coordsStr})` : `over ${loc.label} (${coordsStr})`;
    synthesisEl.textContent = `At this grid cell ${placeWord}, annual ${varCfg.name.toLowerCase()} exhibited a ${trendWord} trend of ${formatSlope(cell.slope, state.activeVar)} ${varCfg.unit} (p = ${formatPValue(cell.p)}). This result is ${sigWord}.`;

    renderChart(cell.series, years, cell.slope, mean, varCfg);
  }

  function selectGlobalOverview() {
    state.selectedCell = null;
    if (state.selectionMarker) {
      state.map.removeLayer(state.selectionMarker);
      state.selectionMarker = null;
    }

    if (!state.regionsData) return;
    const globalReg = state.regionsData.regions.find(r => r.name === 'Global');
    if (!globalReg || !globalReg[state.activeVar]) return;

    const data = globalReg[state.activeVar];
    const varCfg = CONFIG.variables[state.activeVar];
    const years = data.years || [];

    document.getElementById('inspector-title').textContent = 'Planet Earth';
    document.getElementById('inspector-badge').textContent = 'Cosine Area-Weighted';
    document.getElementById('cell-country-name').textContent = 'Entire Earth (Global Average)';
    document.getElementById('cell-coords').textContent = '87.75°S to 87.25°N, 180°W to 180°E';
    document.getElementById('cell-geo-name').textContent = 'Area-Weighted Reanalysis Grid';

    const slopeValEl = document.getElementById('cell-slope');
    const slopeArrowEl = document.getElementById('cell-trend-arrow');
    slopeValEl.textContent = formatSlope(data.slope, state.activeVar);
    slopeArrowEl.textContent = data.slope > 0 ? '↗' : '↘';
    slopeArrowEl.style.color = data.slope > 0 ? '#fff8b2' : '#afefd4';
    document.getElementById('cell-unit').textContent = varCfg.unit;

    document.getElementById('cell-p').textContent = formatPValue(data.p);
    const verdictEl = document.getElementById('cell-verdict');
    if (data.p < 0.05) {
      verdictEl.className = 'verdict-chip chip-significant';
      verdictEl.textContent = 'Statistically Significant (p < 0.05)';
    } else {
      verdictEl.className = 'verdict-chip chip-indeterminate';
      verdictEl.textContent = 'Indeterminate (p ≥ 0.05)';
    }

    const mean = data.series.reduce((a, b) => a + b, 0) / data.series.length;
    const netChange = data.slope * (years.length - 1);

    document.getElementById('cell-baseline').textContent = mean.toFixed(2);
    document.getElementById('cell-baseline-unit').textContent = varCfg.seriesUnit;
    document.getElementById('cell-net-change').textContent = (netChange > 0 ? '+' : '') + netChange.toFixed(2);
    document.getElementById('cell-net-unit').textContent = `${varCfg.seriesUnit} over ${years.length} yrs`;

    document.getElementById('cell-summary-text').textContent = data.summary || 'Global cosine-latitude area-weighted linear regression series.';

    renderChart(data.series, years, data.slope, mean, varCfg);
  }

  function renderChart(series, years, slope, mean, varCfg) {
    const canvas = document.getElementById('timeSeriesChart');
    if (!canvas || !window.Chart) return;

    if (state.chartInstance) {
      state.chartInstance.destroy();
      state.chartInstance = null;
    }

    const meanYear = years.reduce((a, b) => a + b, 0) / years.length;
    const trendLine = years.map(yr => mean + slope * (yr - meanYear));

    const datasets = [
      {
        label: `Observed Mean (${varCfg.seriesUnit})`,
        data: series,
        borderColor: '#afefd4',
        backgroundColor: 'rgba(175, 239, 212, 0.15)',
        pointBackgroundColor: '#fff8b2',
        pointBorderColor: '#237b75',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2.5,
        tension: 0.15,
        fill: false
      },
      {
        label: `OLS Trend (${formatSlope(slope, varCfg.id)} ${varCfg.unit})`,
        data: trendLine,
        borderColor: '#fff8b2',
        borderWidth: 2.2,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false
      }
    ];

    if (state.compareWithGlobal && state.selectedCell && state.regionsData) {
      const globalReg = state.regionsData.regions.find(r => r.name === 'Global');
      if (globalReg && globalReg[state.activeVar]) {
        datasets.push({
          label: `Global Baseline`,
          data: globalReg[state.activeVar].series,
          borderColor: '#54aba1',
          borderWidth: 1.8,
          borderDash: [2, 2],
          pointRadius: 2,
          fill: false
        });
      }
    }

    const ctx = canvas.getContext('2d');
    state.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 14,
              color: '#afefd4',
              font: {
                family: "'Space Grotesk', sans-serif",
                size: 12,
                weight: '600'
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(16, 45, 42, 0.96)',
            titleColor: '#fff8b2',
            bodyColor: '#f0fdf9',
            borderColor: '#afefd4',
            borderWidth: 1.5,
            padding: 12,
            callbacks: {
              label: function (context) {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} ${varCfg.seriesUnit}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(175, 239, 212, 0.08)'
            },
            ticks: {
              color: '#83b3ad',
              font: {
                family: "'JetBrains Mono', monospace",
                size: 11
              }
            }
          },
          y: {
            grid: {
              color: 'rgba(175, 239, 212, 0.08)'
            },
            ticks: {
              color: '#83b3ad',
              font: {
                family: "'JetBrains Mono', monospace",
                size: 11
              }
            }
          }
        }
      }
    });
  }

  // =========================================================================
  // 7. REGIONAL DIAGNOSTICS & SCORECARD
  // =========================================================================

  function renderRegionalDiagnostics() {
    if (!state.regionsData) return;

    const container = document.getElementById('region-cards-container');
    const tableBody = document.getElementById('region-table-body');
    if (!container || !tableBody) return;

    container.innerHTML = '';
    tableBody.innerHTML = '';

    const varCfg = CONFIG.variables[state.activeVar];
    const regions = state.regionsData.regions || [];

    regions.forEach((region) => {
      const regVarData = region[state.activeVar];
      if (!regVarData) return;

      const isSig = regVarData.p < 0.05;
      const slopeStr = formatSlope(regVarData.slope, state.activeVar);
      const pStr = formatPValue(regVarData.p);
      const isGlobal = region.name === 'Global';

      const card = document.createElement('div');
      card.className = `clean-region-card ${isGlobal ? 'global-special-card' : ''}`;

      const boundsStr = isGlobal ? 'Worldwide (87.75°S to 87.25°N)' : `${region.bounds.lat_min}° to ${region.bounds.lat_max}°N, ${region.bounds.lon_min}° to ${region.bounds.lon_max}°E`;

      card.innerHTML = `
        <div class="reg-card-top">
          <div>
            <h3 class="reg-card-name">${region.name}</h3>
            <span class="reg-card-bounds">${boundsStr}</span>
          </div>
          <span class="verdict-chip ${isSig ? 'chip-significant' : 'chip-indeterminate'}">
            ${isSig ? 'Significant' : 'Indeterminate'}
          </span>
        </div>

        <div class="reg-stat-display">
          <div>
            <div class="reg-slope-val">
              ${slopeStr} <span style="font-size:13px;font-weight:500;color:#afefd4;">${varCfg.unit}</span>
            </div>
            <div class="reg-p-val">p = ${pStr} (${isSig ? 'p < 0.05' : 'p ≥ 0.05'})</div>
          </div>
          <span style="font-size:26px;color:#fff8b2;">${regVarData.slope > 0 ? '↗' : '↘'}</span>
        </div>

        <p class="reg-summary-para">${regVarData.summary}</p>

        <div class="reg-spark-holder">
          <canvas class="region-sparkline" width="360" height="55"></canvas>
        </div>

        <button class="btn-reg-jump" data-region="${region.name}">
          <span>Explore on Map</span>
          <span>&rarr;</span>
        </button>
      `;

      container.appendChild(card);

      const sparkCanvas = card.querySelector('.region-sparkline');
      drawSparkline(sparkCanvas, regVarData.series, regVarData.slope > 0 ? '#fff8b2' : '#afefd4');

      card.querySelector('.btn-reg-jump').addEventListener('click', () => {
        focusRegion(region.name);
      });

      // Table Row
      const tr = document.createElement('tr');
      const tempInfo = region['temperature'];
      const precipInfo = region['precipitation'];
      const humidInfo = region['humidity'];
      const windInfo = region['wind'];

      tr.innerHTML = `
        <td style="font-weight:700;color:#fff;">${region.name}</td>
        <td style="font-family:monospace;font-size:12px;color:#83b3ad;">${boundsStr}</td>
        <td>
          <strong style="color:${tempInfo && tempInfo.slope > 0 ? '#fff8b2' : '#afefd4'}">${tempInfo ? formatSlope(tempInfo.slope, 'temperature') : 'N/A'}</strong>
          <span style="display:block;font-size:11px;color:#83b3ad;">p = ${tempInfo ? formatPValue(tempInfo.p) : 'N/A'}</span>
        </td>
        <td>
          <strong style="color:${precipInfo && precipInfo.slope > 0 ? '#afefd4' : '#fff8b2'}">${precipInfo ? formatSlope(precipInfo.slope, 'precipitation') : 'N/A'}</strong>
          <span style="display:block;font-size:11px;color:#83b3ad;">p = ${precipInfo ? formatPValue(precipInfo.p) : 'N/A'}</span>
        </td>
        <td>
          <strong style="color:${humidInfo && humidInfo.slope > 0 ? '#afefd4' : '#fff8b2'}">${humidInfo ? formatSlope(humidInfo.slope, 'humidity') : 'N/A'}</strong>
          <span style="display:block;font-size:11px;color:#83b3ad;">p = ${humidInfo ? formatPValue(humidInfo.p) : 'N/A'}</span>
        </td>
        <td>
          <strong style="color:${windInfo && windInfo.slope > 0 ? '#fff8b2' : '#54aba1'}">${windInfo ? formatSlope(windInfo.slope, 'wind') : 'N/A'}</strong>
          <span style="display:block;font-size:11px;color:#83b3ad;">p = ${windInfo ? formatPValue(windInfo.p) : 'N/A'}</span>
        </td>
        <td>
          <button class="btn-clean-ghost" style="padding:4px 10px;font-size:12px;">Map &rarr;</button>
        </td>
      `;

      tr.querySelector('button').addEventListener('click', () => {
        focusRegion(region.name);
      });

      tableBody.appendChild(tr);
    });
  }

  function drawSparkline(canvas, series, strokeColor) {
    if (!canvas || !series || !series.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = (max - min) || 1;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    series.forEach((val, i) => {
      const x = (i / (series.length - 1)) * (w - 14) + 7;
      const y = h - ((val - min) / range) * (h - 16) - 8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.lineTo((w - 14) + 7, h);
    ctx.lineTo(7, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(175, 239, 212, 0.08)';
    ctx.fill();
  }

  function focusRegion(regionName) {
    switchTab('map-tab');

    if (regionName === 'Global') {
      state.map.flyTo([20, 0], 2, { duration: 1.2 });
      selectGlobalOverview();
      return;
    }

    const bounds = CONFIG.regionBounds[regionName];
    if (bounds && state.map) {
      state.map.flyToBounds(
        [[bounds.lat_min, bounds.lon_min], [bounds.lat_max, bounds.lon_max]],
        { padding: [50, 50], duration: 1.2 }
      );
    }

    if (state.regionsData) {
      const regData = state.regionsData.regions.find(r => r.name === regionName);
      if (regData && regData[state.activeVar]) {
        const item = regData[state.activeVar];
        const varCfg = CONFIG.variables[state.activeVar];
        const years = item.years || [];

        document.getElementById('inspector-title').textContent = regionName;
        document.getElementById('inspector-badge').textContent = 'Region Area-Weighted';
        document.getElementById('cell-country-name').textContent = `${regionName} Study Region`;
        document.getElementById('cell-coords').textContent = `${bounds.lat_min}° to ${bounds.lat_max}°N, ${bounds.lon_min}° to ${bounds.lon_max}°E`;
        document.getElementById('cell-geo-name').textContent = `${regionName} Area-Weighted Composite`;

        document.getElementById('cell-slope').textContent = formatSlope(item.slope, state.activeVar);
        document.getElementById('cell-p').textContent = formatPValue(item.p);
        const verdictEl = document.getElementById('cell-verdict');
        if (item.p < 0.05) {
          verdictEl.className = 'verdict-chip chip-significant';
          verdictEl.textContent = 'Statistically Significant (p < 0.05)';
        } else {
          verdictEl.className = 'verdict-chip chip-indeterminate';
          verdictEl.textContent = 'Indeterminate (p ≥ 0.05)';
        }

        const mean = item.series.reduce((a, b) => a + b, 0) / item.series.length;
        document.getElementById('cell-baseline').textContent = mean.toFixed(2);
        document.getElementById('cell-baseline-unit').textContent = varCfg.seriesUnit;

        const netChange = item.slope * (years.length - 1);
        document.getElementById('cell-net-change').textContent = (netChange > 0 ? '+' : '') + netChange.toFixed(2);
        document.getElementById('cell-net-unit').textContent = `${varCfg.seriesUnit} over ${years.length} yrs`;

        document.getElementById('cell-summary-text').textContent = item.summary;

        renderChart(item.series, years, item.slope, mean, varCfg);
      }
    }
  }

  // =========================================================================
  // 8. DETECTIVE HALL OF FAME (TOP TRENDS WITH COUNTRY NAMES)
  // =========================================================================

  function renderTopTrends() {
    if (!state.topTrendsData) return;

    const varId = state.topTrendsActiveVar;
    const varCfg = CONFIG.variables[varId];
    const varData = state.topTrendsData.variables[varId];
    if (!varData) return;

    const incList = document.getElementById('top-increases-list');
    const decList = document.getElementById('top-decreases-list');
    if (!incList || !decList) return;

    incList.innerHTML = '';
    decList.innerHTML = '';

    document.getElementById('inc-col-subtitle').textContent = `Top 5 significant positive rates of change in ${varCfg.name.toLowerCase()}`;
    document.getElementById('dec-col-subtitle').textContent = `Top 5 significant negative rates of change in ${varCfg.name.toLowerCase()}`;

    const increases = varData.increases || [];
    const decreases = varData.decreases || [];

    increases.forEach((item, idx) => {
      const card = createHotspotCard(item, idx + 1, varCfg, true);
      incList.appendChild(card);
    });

    decreases.forEach((item, idx) => {
      const card = createHotspotCard(item, idx + 1, varCfg, false);
      decList.appendChild(card);
    });
  }

  function createHotspotCard(item, rank, varCfg, isIncrease) {
    const card = document.createElement('div');
    card.className = 'clean-hotspot-card';

    const loc = getCellLocationInfo(item.lat, item.lon);
    const coordStr = formatCoord(item.lat, item.lon);
    const slopeStr = formatSlope(item.slope, varCfg.id);
    const pStr = formatPValue(item.p);
    const valColor = isIncrease ? '#fff8b2' : '#afefd4';
    const placeTitle = loc.country ? `📍 ${loc.country} (${loc.continent})` : `🌊 ${loc.label}`;

    card.innerHTML = `
      <div class="hotspot-rank-badge">#${rank}</div>
      <div>
        <div class="hotspot-country">${placeTitle}</div>
        <div class="hotspot-coord-text">${coordStr}</div>
      </div>
      <div class="hotspot-metrics-box">
        <span class="hotspot-slope-num" style="color:${valColor};">${slopeStr}</span>
        <span class="hotspot-p-badge">p = ${pStr}</span>
      </div>
      <button class="btn-fly-action">
        <span>Fly To</span>
        <span>&rarr;</span>
      </button>
    `;

    card.querySelector('.btn-fly-action').addEventListener('click', () => {
      flyToHotspot(item, varCfg.id);
    });

    return card;
  }

  async function flyToHotspot(item, varId) {
    if (state.activeVar !== varId) {
      await switchVariable(varId);
    }
    switchTab('map-tab');
    state.map.flyTo([item.lat, item.lon], 5, { duration: 1.5 });
    selectCell(item);
  }

  // =========================================================================
  // 9. EVENT LISTENERS & UI WIRING
  // =========================================================================

  function populateCountryDropdown() {
    const select = document.getElementById('select-country-jump');
    if (!select || !state.countriesIndex.length) return;

    select.innerHTML = '<option value="">Search / Jump to Country...</option>';
    state.countriesIndex.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.continent})`;
      select.appendChild(opt);
    });
  }

  function jumpToCountry(countryName) {
    if (!countryName) return;
    const country = state.countriesIndex.find(c => c.name === countryName);
    if (!country || !state.map) return;

    switchTab('map-tab');
    state.map.fitBounds(country.bounds, { padding: [40, 40], maxZoom: 6 });

    const [cLat, cLon] = country.center;
    const cells = (state.trendsDataCache[state.activeVar] && state.trendsDataCache[state.activeVar].cells) || [];
    let nearestCountryCell = null;
    let minDist = Infinity;

    for (const cell of cells) {
      if (getCellLocationInfo(cell.lat, cell.lon).country !== countryName) continue;

      const dLat = cell.lat - cLat;
      const dLon = ((cell.lon - cLon + 540) % 360) - 180;
      const dist = dLat * dLat + dLon * dLon;
      if (dist < minDist) {
        minDist = dist;
        nearestCountryCell = cell;
      }
    }

    if (nearestCountryCell) {
      selectCell(nearestCountryCell);
    } else {
      handleMapClick({ lat: cLat, lng: cLon });
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;

    document.querySelectorAll('.nav-tab').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });

    if (tabId === 'map-tab' && state.map) {
      setTimeout(() => {
        state.map.invalidateSize();
      }, 100);
    }
  }

  async function switchVariable(varId) {
    if (!CONFIG.variables[varId]) return;
    state.activeVar = varId;

    document.querySelectorAll('#indicator-buttons .indicator-card').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-var') === varId);
    });

    await ensureTrendsData(varId);
    updateHeaderGlobalStatus();
    updateYearSliderBounds();
    renderGridCells();

    if (state.selectedCell) {
      const cached = state.trendsDataCache[varId];
      if (cached && cached.cells) {
        const match = cached.cells.find(c => Math.abs(c.lat - state.selectedCell.lat) < 0.1 && Math.abs(c.lon - state.selectedCell.lon) < 0.1);
        if (match) {
          selectCell(match);
        } else {
          selectGlobalOverview();
        }
      }
    } else {
      selectGlobalOverview();
    }

    renderRegionalDiagnostics();
  }

  function updateHeaderGlobalStatus() {
    if (!state.regionsData) return;
    const globalReg = state.regionsData.regions.find(r => r.name === 'Global');
    if (!globalReg || !globalReg[state.activeVar]) return;

    const info = globalReg[state.activeVar];
    const varCfg = CONFIG.variables[state.activeVar];
    const statusText = document.getElementById('global-status-text');
    if (statusText) {
      statusText.textContent = `${formatSlope(info.slope, state.activeVar)} ${varCfg.unit} (p=${formatPValue(info.p)})`;
    }
  }

  function updateYearSliderBounds() {
    const data = state.trendsDataCache[state.activeVar];
    if (!data || !data.years) return;

    const years = data.years;
    const minYear = years[0];
    const maxYear = years[years.length - 1];

    const slider = document.getElementById('year-slider');
    const label = document.getElementById('current-year-label');

    if (slider) {
      slider.min = minYear;
      slider.max = maxYear;
      if (state.activeAnomalyYear > maxYear || state.activeAnomalyYear < minYear) {
        state.activeAnomalyYear = maxYear;
      }
      slider.value = state.activeAnomalyYear;
    }
    if (label) {
      label.textContent = state.activeAnomalyYear;
    }
  }

  function setupEventListeners() {
    // Nav Tabs
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        switchTab(tabId);
      });
    });

    // Indicator Pills (Header)
    document.querySelectorAll('#indicator-buttons .indicator-card').forEach(btn => {
      btn.addEventListener('click', async () => {
        const varId = btn.getAttribute('data-var');
        await switchVariable(varId);
      });
    });

    // Basemap Selector
    const selectBasemap = document.getElementById('select-basemap');
    if (selectBasemap) {
      selectBasemap.addEventListener('change', (e) => {
        state.activeBasemap = e.target.value;
        applyBasemap(state.activeBasemap);
      });
    }

    // Grid Opacity Slider
    const sliderOpacity = document.getElementById('slider-opacity');
    const opacityLabel = document.getElementById('opacity-label');
    if (sliderOpacity) {
      sliderOpacity.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.gridOpacity = val / 100;
        if (opacityLabel) opacityLabel.textContent = `${val}%`;
        renderGridCells();
      });
    }

    // Country Jump Dropdown
    const selectCountry = document.getElementById('select-country-jump');
    if (selectCountry) {
      selectCountry.addEventListener('change', (e) => {
        jumpToCountry(e.target.value);
      });
    }

    // View Mode Control (Trend vs Anomaly)
    const viewModeControl = document.getElementById('view-mode-control');
    if (viewModeControl) {
      viewModeControl.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          viewModeControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          state.viewMode = btn.getAttribute('data-mode');
          const anomalyControls = document.getElementById('anomaly-controls');
          if (anomalyControls) {
            anomalyControls.classList.toggle('hidden', state.viewMode !== 'anomaly');
          }
          renderGridCells();
        });
      });
    }

    // Year Slider (Anomaly mode)
    const yearSlider = document.getElementById('year-slider');
    if (yearSlider) {
      yearSlider.addEventListener('input', (e) => {
        state.activeAnomalyYear = parseInt(e.target.value, 10);
        document.getElementById('current-year-label').textContent = state.activeAnomalyYear;
        renderGridCells();
      });
    }

    // Play/Pause Year Timeline
    const btnPlay = document.getElementById('btn-play-years');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        if (state.isPlayingYears) {
          stopYearPlayback();
        } else {
          startYearPlayback();
        }
      });
    }

    // Significant Only Filter Toggle
    const chkSigOnly = document.getElementById('chk-sig-only');
    if (chkSigOnly) {
      chkSigOnly.addEventListener('change', (e) => {
        state.sigOnly = e.target.checked;
        renderGridCells();
      });
    }

    // Reset Map View
    const btnResetMap = document.getElementById('btn-reset-map');
    if (btnResetMap) {
      btnResetMap.addEventListener('click', () => {
        state.map.flyTo([20, 0], 2, { duration: 1.2 });
        selectGlobalOverview();
      });
    }

    // Chart Compare with Global Checkbox
    const chkCompareGlobal = document.getElementById('chk-compare-global');
    if (chkCompareGlobal) {
      chkCompareGlobal.addEventListener('change', (e) => {
        state.compareWithGlobal = e.target.checked;
        if (state.selectedCell) {
          selectCell(state.selectedCell);
        } else {
          selectGlobalOverview();
        }
      });
    }

    // Reset to Global in Inspector
    const btnSelectGlobal = document.getElementById('btn-select-global');
    if (btnSelectGlobal) {
      btnSelectGlobal.addEventListener('click', () => {
        selectGlobalOverview();
      });
    }

    // Export CSV Button
    const btnExportCSV = document.getElementById('btn-export-csv');
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', exportCurrentDataCSV);
    }

    // Top Trends Indicator Pills (Tab 3)
    document.querySelectorAll('#top-trends-indicator-pills .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#top-trends-indicator-pills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.topTrendsActiveVar = btn.getAttribute('data-top-var');
        renderTopTrends();
      });
    });

    // Warning Banner Close Button
    const btnCloseWarn = document.getElementById('btn-close-warning');
    if (btnCloseWarn) {
      btnCloseWarn.addEventListener('click', () => {
        document.getElementById('protocol-warning').classList.add('hidden');
      });
    }
  }

  function startYearPlayback() {
    const slider = document.getElementById('year-slider');
    const btnPlay = document.getElementById('btn-play-years');
    if (!slider || !btnPlay) return;

    state.isPlayingYears = true;
    btnPlay.textContent = '⏸ Pause';

    const min = parseInt(slider.min, 10);
    const max = parseInt(slider.max, 10);

    state.playInterval = setInterval(() => {
      let nextYear = state.activeAnomalyYear + 1;
      if (nextYear > max) nextYear = min;

      state.activeAnomalyYear = nextYear;
      slider.value = nextYear;
      document.getElementById('current-year-label').textContent = nextYear;
      renderGridCells();
    }, 700);
  }

  function stopYearPlayback() {
    state.isPlayingYears = false;
    const btnPlay = document.getElementById('btn-play-years');
    if (btnPlay) {
      btnPlay.textContent = '▶ Play';
    }
    if (state.playInterval) {
      clearInterval(state.playInterval);
      state.playInterval = null;
    }
  }

  function exportCurrentDataCSV() {
    const varCfg = CONFIG.variables[state.activeVar];
    let title = 'Global_Mean';
    let lat = 0, lon = 0, slope = 0, p = 0;
    let series = [];
    let years = [];

    const data = state.trendsDataCache[state.activeVar];
    years = (data && data.years) || [];

    if (state.selectedCell) {
      const loc = getCellLocationInfo(state.selectedCell.lat, state.selectedCell.lon);
      title = loc.country ? `${loc.country}_${state.selectedCell.lat}_${state.selectedCell.lon}` : `Cell_${state.selectedCell.lat}_${state.selectedCell.lon}`;
      lat = state.selectedCell.lat;
      lon = state.selectedCell.lon;
      slope = state.selectedCell.slope;
      p = state.selectedCell.p;
      series = state.selectedCell.series;
    } else if (state.regionsData) {
      const globalReg = state.regionsData.regions.find(r => r.name === 'Global');
      if (globalReg && globalReg[state.activeVar]) {
        title = 'Global_Weighted_Mean';
        slope = globalReg[state.activeVar].slope;
        p = globalReg[state.activeVar].p;
        series = globalReg[state.activeVar].series;
      }
    }

    if (!series || !series.length) {
      alert('No time series data available to export.');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += `# TerraTrend NASA MERRA-2 Time Series Export\n`;
    csvContent += `# Indicator: ${varCfg.name} (${varCfg.unit})\n`;
    csvContent += `# Location: ${title} [Lat: ${lat}, Lon: ${lon}]\n`;
    csvContent += `# Slope: ${slope} ${varCfg.unit}, p-value: ${p}\n`;
    csvContent += `Year,Observed_Value_${varCfg.seriesUnit},Trend_Fit_${varCfg.seriesUnit}\n`;

    const meanYear = years.reduce((a, b) => a + b, 0) / years.length;
    const meanVal = series.reduce((a, b) => a + b, 0) / series.length;

    years.forEach((yr, idx) => {
      const val = series[idx];
      const fit = meanVal + slope * (yr - meanYear);
      csvContent += `${yr},${val !== undefined ? val : ''},${fit.toFixed(4)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `TerraTrend_${varCfg.id}_${title}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // =========================================================================
  // 10. APP BOOTSTRAP
  // =========================================================================

  async function initApp() {
    try {
      initMap();
      setupEventListeners();

      const [regions, topTrends, countriesIdx, cellLocs, countriesGeo] = await Promise.all([
        loadJSON(`${CONFIG.dataDir}/regions.json`),
        loadJSON(`${CONFIG.dataDir}/top_trends.json`),
        loadJSON(`${CONFIG.dataDir}/countries_index.json`),
        loadJSON(`${CONFIG.dataDir}/cell_locations.json`),
        loadJSON(`${CONFIG.dataDir}/countries.geojson`).catch(() => null)
      ]);

      state.regionsData = regions;
      state.topTrendsData = topTrends;
      state.countriesIndex = countriesIdx || [];
      state.cellLocations = cellLocs || {};
      state.countriesGeoJSON = countriesGeo;

      populateCountryDropdown();
      renderCountryBoundaries();

      await switchVariable('temperature');

      renderRegionalDiagnostics();
      renderTopTrends();

      console.log('TerraTrend Earth-Teal Theme loaded successfully.');
    } catch (err) {
      console.error('Initialization error in TerraTrend app:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
