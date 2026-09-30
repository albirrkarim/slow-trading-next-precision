import moment from "moment-timezone";

export function formatPrice(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return value < 1 ? value.toFixed(4) : value.toFixed(2);
}

export function formatNumber(value?: number, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(digits);
}

export function formatUsdt(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(2);
}

export function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Builds the CoinGlass pair heatmap URL for a dashboard position symbol. */
export function getCoinGlassLiquidationMapUrl(symbol: string) {
  const coin = symbol
    .trim()
    .toUpperCase()
    .replace(/[-/_]?(?:USDT|USDC)$/u, "");

  return `https://www.coinglass.com/pro/futures/LiquidationHeatMapNew?coin=${encodeURIComponent(coin)}&type=pair`;
}

export function formatDate(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

/** Formats stale-monitoring status in the fixed Jakarta operator timezone. */
export function formatLastMonitoredLabel(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Never monitored";
  }

  return `Last monitored is ${moment(value)
    .tz("Asia/Jakarta")
    .format("DD MMM HH:mm [WIB]")}`;
}
