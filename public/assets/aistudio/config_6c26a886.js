export const VARIABLES = {
  temperature: {
    label: "Temperature",
    fullLabel: "Near-surface air temperature",
    units: "°C/year",
    shortUnits: "°C/yr",
    seriesUnits: "°C",
    years: "2014–2025",
    domain: 0.35,
    decimals: 4,
    tickDecimals: 2,
    color: "#E69F00",
    increase: "warming",
    decrease: "cooling",
    legendDirection: "Blue = cooling · red = warming",
    source: "NASA MERRA-2",
  },
  precipitation: {
    label: "Precipitation",
    fullLabel: "Annual total precipitation",
    units: "mm/year per year",
    shortUnits: "mm/yr per yr",
    seriesUnits: "mm/year",
    years: "2014–2023",
    domain: 220,
    decimals: 1,
    tickDecimals: 0,
    color: "#56B4E9",
    increase: "wetter",
    decrease: "drier",
    legendDirection: "Blue = drier · red = wetter",
    source: "NASA MERRA-2",
  },
  humidity: {
    label: "Humidity",
    fullLabel: "2-meter specific humidity",
    units: "g/kg/year",
    shortUnits: "g/kg/yr",
    seriesUnits: "g/kg",
    years: "2014–2025",
    domain: 0.2,
    decimals: 4,
    tickDecimals: 2,
    color: "#009E73",
    increase: "moistening",
    decrease: "drying",
    legendDirection: "Blue = drying · red = moistening",
    source: "NASA MERRA-2",
  },
  wind: {
    label: "Wind",
    fullLabel: "10-meter mean wind speed",
    units: "m/s/year",
    shortUnits: "m/s/yr",
    seriesUnits: "m/s",
    years: "2014–2025",
    domain: 0.25,
    decimals: 4,
    tickDecimals: 2,
    color: "#CC79A7",
    increase: "strengthening",
    decrease: "weakening",
    legendDirection: "Blue = weakening · red = strengthening",
    source: "NASA MERRA-2",
  },
};

export const VARIABLE_ORDER = ["temperature", "precipitation", "humidity", "wind"];
export const INITIAL_VARIABLE = "temperature";
export const GLOBAL_CELL_COUNT = 2592;
export const SIGNIFICANCE_LEVEL = 0.05;

export const RD_BU = [
  "#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7",
  "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f",
];

export const CHART_COLORS = {
  data: "#EEF2FA",
  trend: "#FFB454",
  compare: "#8B7CF6",
  grid: "rgba(163, 174, 203, 0.14)",
  axis: "#A3AECB",
  tooltipBg: "#19223A",
  tooltipBorder: "#35486F",
  tooltipText: "#EEF2FA",
};

export const PATHS = {
  trends: (variable) => `data/trends_${variable}.json`,
  regions: "data/regions.json",
  topTrends: "data/top_trends.json",
  countries: "data/countries.geojson",
  countriesIndex: "data/countries_index.json",
  cellLocations: "data/cell_locations.json",
  placesIndex: "data/places/index.json",
  placeCountries: "data/places/countries.json",
  placeCities: (code) => `data/places/cities/${code}.json`,
};
