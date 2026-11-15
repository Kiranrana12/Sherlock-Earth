/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
// Small JSON loader with an in-memory cache.
// A failed request is evicted so a retry can actually refetch it.

import { PATHS } from "./config.js";

const cache = new Map();

async function fetchJSON(url) {
  let response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  let contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    const bust = url.includes("?") ? "&" : "?";
    response = await fetch(`${url}${bust}_ts=${Date.now()}`, { cache: "reload" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    contentType = response.headers.get("content-type") || "";
  }
  if (!contentType.includes("json")) {
    throw new Error(`Missing dataset file (${url})`);
  }
  return response.json();
}

function load(key, url) {
  if (!cache.has(key)) {
    const request = fetchJSON(url).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, request);
  }
  return cache.get(key);
}

export const loadTrends = (variable) => load(`trends:${variable}`, PATHS.trends(variable));
export const loadRegions = () => load("regions", PATHS.regions);
export const loadTopTrends = () => load("topTrends", PATHS.topTrends);
export const loadCountries = () => load("countries", PATHS.countries);
export const loadCountriesIndex = () => load("countriesIndex", PATHS.countriesIndex);
export const loadCellLocations = () => load("cellLocations", PATHS.cellLocations);
export const loadPlacesIndex = () => load("placesIndex", PATHS.placesIndex);
export const loadPlaceCountries = () => load("placeCountries", PATHS.placeCountries);
export const loadPlaceCities = (code) => load(`placeCities:${code}`, PATHS.placeCities(code));

export function clear(key) {
  cache.delete(key);
}
