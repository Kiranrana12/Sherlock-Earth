// Place search and country hit-testing.
// The 1.1 MB search index is fetched only when someone uses search, and the
// country outlines only when country mode is switched on.

import { loadCountries, loadPlacesIndex } from "./data.js";
import { foldSearch } from "./utils.js";

let placesPromise = null;
let preparedPlaces = null;
let countryPromise = null;
let countries = null;

function preparePlaces(items) {
  return items.map((item) => {
    const nameFold = foldSearch(item.name);
    const haystack = foldSearch(
      [item.name, item.country, item.country_code, item.continent, item.type].filter(Boolean).join(" "),
    );
    return { ...item, nameFold, haystack };
  });
}

export function ensurePlaceSearch() {
  if (!placesPromise) {
    placesPromise = loadPlacesIndex()
      .then((items) => {
        preparedPlaces = preparePlaces(items);
        return preparedPlaces;
      })
      .catch((error) => {
        placesPromise = null;
        throw error;
      });
  }
  return placesPromise;
}

export function searchPlaces(query, limit = 8) {
  if (!preparedPlaces) return [];
  const folded = foldSearch(query);
  if (!folded) return [];
  const tokens = folded.split(" ").filter(Boolean);
  const matches = [];

  for (const item of preparedPlaces) {
    if (!tokens.every((token) => item.haystack.includes(token))) continue;

    let score = 35;
    if (item.nameFold === folded) score = 100;
    else if (item.nameFold.startsWith(folded)) score = 80;
    else if (item.nameFold.split(" ").some((word) => word.startsWith(folded))) score = 70;
    else if (item.nameFold.includes(folded)) score = 55;
    if (item.type === "country") score += 10;

    matches.push({ item, score });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.name.length - b.item.name.length ||
      a.item.name.localeCompare(b.item.name),
  );
  return matches.slice(0, limit).map((match) => match.item);
}

export function ensureCountryLookup() {
  if (!countryPromise) {
    countryPromise = loadCountries()
      .then((geo) => {
        countries = [];
        for (const feature of geo.features) {
          const props = feature.properties || {};
          if (!props.ADM0_A3 || !feature.geometry) continue;
          const polygons = [];
          const shapes =
            feature.geometry.type === "Polygon"
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates;

          for (const shape of shapes) {
            const ring = shape?.[0];
            if (!ring || ring.length < 3) continue;
            let minLon = Infinity;
            let minLat = Infinity;
            let maxLon = -Infinity;
            let maxLat = -Infinity;
            for (const [lon, lat] of ring) {
              if (lon < minLon) minLon = lon;
              if (lon > maxLon) maxLon = lon;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            }
            polygons.push({ ring, bbox: [minLon, minLat, maxLon, maxLat] });
          }

          countries.push({
            code: props.ADM0_A3,
            name: props.NAME,
            continent: props.CONTINENT,
            polygons,
          });
        }
        return countries;
      })
      .catch((error) => {
        countryPromise = null;
        countries = null;
        throw error;
      });
  }
  return countryPromise;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryAt(lat, lon) {
  if (!countries) return null;
  for (const country of countries) {
    for (const polygon of country.polygons) {
      const [minLon, minLat, maxLon, maxLat] = polygon.bbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
      if (pointInRing(lon, lat, polygon.ring)) {
        return { code: country.code, name: country.name, continent: country.continent };
      }
    }
  }
  return null;
}
