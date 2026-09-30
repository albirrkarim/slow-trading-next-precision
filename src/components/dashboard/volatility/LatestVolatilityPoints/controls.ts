import type { SortDirection, SortKey } from "./columns";
import { SORT_DIRECTIONS, SORT_KEYS } from "./columns";

export const ROWS_PER_PAGE_OPTIONS = [25, 50, 100] as const;
const STORAGE_KEY = "slow-trading:latest-volatility-points:controls:v1";
const ROWS_PER_PAGE_VALUES = new Set<number>(ROWS_PER_PAGE_OPTIONS);
export const SYMBOL_SEARCH_MAX_LENGTH = 1_000;

export interface LatestVolatilityPointControls {
  rowsPerPage: number;
  selectedTags: string[];
  sortDirection: SortDirection;
  sortKey: SortKey;
  symbolSearch: string;
}

const DEFAULT_CONTROLS: LatestVolatilityPointControls = {
  rowsPerPage: 25,
  selectedTags: [],
  sortDirection: "asc",
  sortKey: "symbol",
  symbolSearch: "",
};

/** Normalizes the latest-table symbol search text for stable matching/storage. */
export function normalizeSymbolSearch(value: unknown) {
  return typeof value === "string"
    ? value
      .trim()
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s+/g, " ")
      .slice(0, SYMBOL_SEARCH_MAX_LENGTH)
    : "";
}

/** Checks whether a symbol should remain visible for the current symbol search. */
export function matchesLatestVolatilitySymbolSearch({
  search,
  symbol,
}: {
  search: string;
  symbol: string;
}) {
  const normalizedSearch = normalizeSymbolSearch(search).toLocaleUpperCase();
  if (!normalizedSearch) return true;

  const normalizedSymbol = symbol.trim().toLocaleUpperCase();
  const searchTerms = normalizedSearch
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  if (searchTerms.length > 1 || normalizedSearch.includes(",")) {
    return searchTerms.includes(normalizedSymbol);
  }

  return normalizedSymbol.includes(normalizedSearch);
}

/** Parses saved table controls while ignoring malformed or obsolete fields. */
function parseControls(raw: string | null): LatestVolatilityPointControls {
  if (!raw) return DEFAULT_CONTROLS;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const sortKey = SORT_KEYS.has(value.sortKey as SortKey)
      ? (value.sortKey as SortKey)
      : DEFAULT_CONTROLS.sortKey;
    const sortDirection = SORT_DIRECTIONS.has(
      value.sortDirection as SortDirection,
    )
      ? (value.sortDirection as SortDirection)
      : DEFAULT_CONTROLS.sortDirection;
    const rowsPerPage = ROWS_PER_PAGE_VALUES.has(Number(value.rowsPerPage))
      ? Number(value.rowsPerPage)
      : DEFAULT_CONTROLS.rowsPerPage;
    const selectedTags = Array.isArray(value.selectedTags)
      ? Array.from(
        new Set(
          value.selectedTags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      )
      : DEFAULT_CONTROLS.selectedTags;
    const symbolSearch = normalizeSymbolSearch(value.symbolSearch);

    return { rowsPerPage, selectedTags, sortDirection, sortKey, symbolSearch };
  } catch {
    return DEFAULT_CONTROLS;
  }
}

export function readControls() {
  if (typeof window === "undefined") return DEFAULT_CONTROLS;

  try {
    return parseControls(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_CONTROLS;
  }
}

export function writeControls(controls: LatestVolatilityPointControls) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}
