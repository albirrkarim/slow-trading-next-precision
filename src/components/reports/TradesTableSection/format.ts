import moment from "moment";
import type { ReportRow } from "../types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRADE_CHART_CONTEXT_MS = 30 * DAY_MS;
export const TRADE_TIME_FORMAT = "DD MMM YYYY HH:mm";
export const TRADE_TIME_SAME_MONTH_FORMAT = "DD MMM HH:mm";

export function formatTradeTime({
  compareTimeMs,
  timeMs,
}: {
  compareTimeMs?: number;
  timeMs?: number;
}) {
  if (!timeMs) {
    return "—";
  }

  const tradeMoment = moment(timeMs);

  if (compareTimeMs && tradeMoment.isSame(moment(compareTimeMs), "month")) {
    return tradeMoment.format(TRADE_TIME_SAME_MONTH_FORMAT);
  }

  return tradeMoment.format(TRADE_TIME_FORMAT);
}

export function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—";
}

export function formatUsdt(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value >= 0 ? "+" : ""}${value.toFixed(2)}`
    : "—";
}

/** Gets the entry margin for display, with legacy fallbacks for old rows. */
export function getEntryMarginUsdt(row: ReportRow) {
  if (typeof row.exposure.marginUsdt === "number" && Number.isFinite(row.exposure.marginUsdt)) {
    return row.exposure.marginUsdt;
  }

  if (
    typeof row.exposure.notionalUsdt === "number" &&
    Number.isFinite(row.exposure.notionalUsdt) &&
    typeof row.exposure.leverage === "number" &&
    Number.isFinite(row.exposure.leverage) &&
    row.exposure.leverage > 0
  ) {
    return row.exposure.notionalUsdt / row.exposure.leverage;
  }

  return typeof row.exposure.notionalUsdt === "number" && Number.isFinite(row.exposure.notionalUsdt)
    ? row.exposure.notionalUsdt
    : 0;
}
