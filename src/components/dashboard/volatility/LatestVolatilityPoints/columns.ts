import type { UnifiedFundingRate } from "@/lib/exchange";
import type { RuntimeEntrySequenceCount } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import type { VolatilityPointLabelFrequency } from "./types";

export type SortDirection = "asc" | "desc";
export type SortKey =
  | "symbol"
  | "price"
  | "marketCap"
  | "fundingRate"
  | "entrySequence"
  | "frequency"
  | "metadata"
  | "volume"
  | "level"
  | "time";

export interface LatestVolatilityPointTableRow {
  descriptionText: string;
  entrySequenceCount: RuntimeEntrySequenceCount;
  estimatedMaxEntry: number | undefined;
  fundingRate: UnifiedFundingRate | undefined;
  index: number;
  levelFrequency: Record<string, number>;
  labelFrequency: VolatilityPointLabelFrequency;
  marketCapFetchedAt: number | undefined;
  marketCapUSD: number | undefined;
  point: VolatilityPoint;
  pointCount: number;
  symbol: string;
  volume24h: number | undefined;
}

export interface LatestVolatilityPointColumn {
  help: {
    meaning: string | ((minEntryAbsLevel?: number, maxEntryAbsLevel?: number) => string);
    source: string;
  };
  key: SortKey;
  label: string;
  width?: string;
}

export const COLUMNS: LatestVolatilityPointColumn[] = [
  {
    help: {
      meaning:
        "The coin symbol currently included in this PRECISION configuration. Removing it prevents new entries but does not stop management of an open position.",
      source: "Coin Management → Symbols and locally stored coin metadata.",
    },
    key: "symbol",
    label: "Symbol",
    width: "500px",
  },
  {
    help: {
      meaning:
        "Price recorded on the coin's latest volatility point in the loaded dashboard range. It is not a continuously streaming quote.",
      source: "The latest loaded volatility-point record generated from exchange kline data.",
    },
    key: "price",
    label: "Latest price",
  },
  {
    help: {
      meaning:
        "Circulating market capitalization in USD. A larger market cap does not necessarily guarantee deeper order-book liquidity.",
      source:
        "CoinMarketCap, stored in the persistent per-symbol cache for up to 24 hours. The row shows when the cached value was fetched.",
    },
    key: "marketCap",
    label: "Market cap",
  },
  {
    help: {
      meaning:
        "Think of it as which side is more crowded. A positive rate often means the market is crowded LONG, so LONG pays SHORT. A negative rate often means the market is crowded SHORT, so SHORT pays LONG. It does not measure the number of traders. The rate is for one funding interval and applies only if the position is open at settlement.",
      source:
        "Binance USD-M public premium-index snapshot. The row shows Binance's snapshot time.",
    },
    key: "fundingRate",
    label: "Funding rate",
  },
  {
    help: {
      meaning: (minEntryAbsLevel, maxEntryAbsLevel) =>
        `Number of historical entry-sequence candidates in the loaded range with ${minEntryAbsLevel === undefined ? "no minimum" : `an absolute level of at least ${minEntryAbsLevel}`}${maxEntryAbsLevel === undefined ? " and no maximum" : ` and at most ${maxEntryAbsLevel}`}. LONG and SHORT counts are shown separately.`,
      source:
        "Entry-sequence candidates calculated from loaded volatility-point history and the configured entry-level range.",
    },
    key: "entrySequence",
    label: "Count entry sequence",
  },
  {
    help: {
      meaning:
        "Total volatility-point count for the coin in the loaded range. T and B show TOP/BOTTOM shares; level[count] shows how often each level occurred.",
      source: "The loaded volatility-point history for this dashboard range.",
    },
    key: "frequency",
    label: "Frequency",
  },
  {
    help: {
      meaning:
        "Editable notes about the coin. This text is informational and is not used in strategy calculations.",
      source: "Locally stored coin metadata entered by the user.",
    },
    key: "metadata",
    label: "Description",
    width: "500px",
  },
  {
    help: {
      meaning:
        "The coin's 24-hour quote volume and a capacity estimate based on the configured maximum-entry percentage. The estimate is not guaranteed fill liquidity.",
      source:
        "The active exchange's 24-hour ticker data, combined with Max Entry Based on 24-Hour Volume % from the PRECISION configuration.",
    },
    key: "volume",
    label: "24h volume & estimated max entry",
  },
  {
    help: {
      meaning:
        "The latest volatility-point level and its age. Positive levels are TOP points, negative levels are BOTTOM points, and a larger absolute value is a more extreme level. Chips below show whether each enabled account has used this vPoint for entry.",
      source: "The latest loaded volatility-point record for the coin.",
    },
    key: "level",
    label: "Last level",
  },
  {
    help: {
      meaning:
        "Manual controls to open an entry, inspect the chart or JSON, and remove the coin from new-entry configuration.",
      source: "Dashboard actions backed by the PRECISION runtime and configuration APIs.",
    },
    key: "time",
    label: "Action",
    width: "50px",
  },
];

export const SORT_KEYS = new Set<SortKey>(COLUMNS.map((column) => column.key));
export const SORT_DIRECTIONS = new Set<SortDirection>(["asc", "desc"]);

/** Resolves table-header explanations from the same definitions used by the UI. */
export function getLatestVolatilityPointColumnHelp(
  minEntryAbsLevel?: number,
  maxEntryAbsLevel?: number,
) {
  return COLUMNS.map((column) => ({
    key: column.key,
    meaning:
      typeof column.help.meaning === "function"
        ? column.help.meaning(minEntryAbsLevel, maxEntryAbsLevel)
        : column.help.meaning,
    source: column.help.source,
  }));
}
