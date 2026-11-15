// Accent-insensitive place combobox over the lazy search index.
// The index is fetched on first focus, then filtering runs in memory.

import { ensurePlaceSearch, searchPlaces } from "./places.js";
import { debounce, escapeHTML } from "./utils.js";

const MAX_RESULTS = 8;

function optionId(index) {
  return `place-option-${index}`;
}

export function createPlaceSearch({ input, list, status, onSelect }) {
  let items = [];
  let active = -1;
  let loaded = false;
  let request = 0;

  function announce(text) {
    status.textContent = text;
  }

  function setExpanded(open) {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) {
      active = -1;
      input.removeAttribute("aria-activedescendant");
    }
  }

  function showMessage(text, { error = false } = {}) {
    list.innerHTML = `<div class="search-empty${error ? " is-error" : ""}" role="presentation">${text}</div>`;
    setExpanded(true);
  }

  function paintSelection() {
    for (const option of list.querySelectorAll(".search-option")) {
      option.setAttribute("aria-selected", String(Number(option.dataset.index) === active));
    }
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", optionId(active));
      list.querySelector(`#${optionId(active)}`)?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderResults(query) {
    items = searchPlaces(query, MAX_RESULTS);
    if (!items.length) {
      showMessage(`No country or city matches “${escapeHTML(query)}”.`);
      announce(`No matches for ${query}.`);
      return;
    }

    active = 0;
    list.innerHTML = items
      .map((item, index) => {
        const meta =
          item.type === "country"
            ? ["Country", item.continent].filter(Boolean).join(" · ")
            : ["City", item.country || item.continent].filter(Boolean).join(" · ");
        return `<button type="button" class="search-option" role="option" id="${optionId(index)}" data-index="${index}" tabindex="-1" aria-selected="false">
          <span class="search-option-name">${escapeHTML(item.name)}</span>
          <span class="search-option-meta">${escapeHTML(meta)}</span>
        </button>`;
      })
      .join("");
    setExpanded(true);
    paintSelection();
    announce(`${items.length} match${items.length === 1 ? "" : "es"}. Use the arrow keys and Enter.`);
  }

  function runSearch(query) {
    const sequence = ++request;
    if (!loaded) showMessage("Loading the place index…");

    ensurePlaceSearch()
      .then(() => {
        loaded = true;
        if (sequence !== request) return;
        renderResults(query);
      })
      .catch(() => {
        if (sequence !== request) return;
        items = [];
        showMessage("Place search data could not load. Check the connection and try again.", { error: true });
        announce("Place search data could not load.");
      });
  }

  const scheduleSearch = debounce((query) => runSearch(query), 140);

  function choose(item) {
    request += 1;
    scheduleSearch.cancel();
    items = [];
    setExpanded(false);
    input.value = item.name;
    const where = item.type === "country" ? item.continent : item.country;
    announce(`Showing ${item.name}${where ? `, ${where}` : ""}.`);
    onSelect?.(item);
  }

  function move(delta) {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    paintSelection();
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    if (!query) {
      request += 1;
      scheduleSearch.cancel();
      items = [];
      setExpanded(false);
      announce("");
      return;
    }
    if (!loaded) showMessage("Loading the place index…");
    scheduleSearch(query);
  });

  input.addEventListener("focus", () => {
    ensurePlaceSearch().catch(() => {});
    if (input.value.trim() && items.length) {
      setExpanded(true);
      paintSelection();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden && input.value.trim()) runSearch(input.value.trim());
      else move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!list.hidden) move(-1);
    } else if (event.key === "Enter") {
      if (!list.hidden && active >= 0) {
        event.preventDefault();
        choose(items[active]);
      }
    } else if (event.key === "Escape") {
      if (!list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        announce("Search closed.");
      }
    } else if (event.key === "Tab") {
      setExpanded(false);
    }
  });

  input.addEventListener("blur", (event) => {
    if (!list.contains(event.relatedTarget)) setExpanded(false);
  });

  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest(".search-option");
    if (!option) return;
    const item = items[Number(option.dataset.index)];
    if (item) choose(item);
  });

  return {
    focus: () => input.focus(),
  };
}
