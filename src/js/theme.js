/* SI-assisted: drafted with SI tools and reviewed and tested by the team. */
import { refreshChartTheme } from "./charts.js";

const STORAGE_KEY = "change-atlas-theme";
const THEMES = ["night", "paper"];
const THEME_COLORS = { night: "#0A0F1F", paper: "#F7F5F0" };

function currentTheme() {
  return document.documentElement.dataset.theme === "paper" ? "paper" : "night";
}

export function initTheme() {
  const options = Array.from(document.querySelectorAll("[data-theme-value]"));
  const meta = document.querySelector('meta[name="theme-color"]');

  function apply(theme, { persist = true } = {}) {
    const next = THEMES.includes(theme) ? theme : "night";
    document.documentElement.dataset.theme = next;
    if (meta) meta.setAttribute("content", THEME_COLORS[next]);
    for (const button of options) {
      button.setAttribute("aria-pressed", String(button.dataset.themeValue === next));
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {
        /* private browsing can block storage */
      }
    }
    refreshChartTheme();
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
  }

  for (const button of options) {
    button.addEventListener("click", () => apply(button.dataset.themeValue));
  }

  apply(currentTheme(), { persist: false });
}
