import type {
  Position,
  PositionPnlPoint,
} from "./types";
import { TradingMode } from "@/lib/exchange/types";
import type { ExchangeType } from "../types";
import type { UnifiedFundingRate } from "@/lib/exchange/types";
import { getFeeCalculator } from "@/lib/exchange/fees";
import { TokocryptoFees } from "@/lib/exchange/platform/tokocrypto/constants";
import {
  applyPositionNetUsdtExtrema,
  computeClosedPositionMetrics,
} from "./pnl";

const MINUTE_MS = 60 * 1000;
const DEFAULT_HISTORY_BUCKET_MINUTES = 60;
const MAX_HISTORY_POINTS = 24 * 90;
const DEFAULT_ROUND_TRIP_FEE_RATIO =
  TokocryptoFees.getBothSideFeePercent({
    type: "taker",
  }) / 100;

/** Normalized PnL-history point used by reporting helpers. */
type ReportHistoryPoint = PositionPnlPoint;

/** Rounds pct to the persisted dashboard precision. */
function roundPct(value: number): number {
  return Number(value.toFixed(3));
}

/** Rounds USDT to the persisted dashboard precision. */
function roundUsdt(value: number): number {
  return Number(value.toFixed(6));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Normalizes the configured PnL-history bucket to whole positive minutes. */
function normalizeBucketMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HISTORY_BUCKET_MINUTES;
  }

  return Math.max(1, Math.floor(parsed));
}

/** Resolves the configured PnL-history bucket to milliseconds. */
function resolveBucketMs(value: unknown): number {
  return normalizeBucketMinutes(value) * MINUTE_MS;
}

/** Normalizes persisted PnL-history points into the canonical `{t, pct}` shape. */
function normalizeHistoryPoints(raw: unknown): ReportHistoryPoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (isFiniteNumber(item?.t) && isFiniteNumber(item?.pct)) {
        return {
          t: item.t,
          pct: roundPct(item.pct),
        };
      }

      if (isFiniteNumber(item?.timeMs) && isFiniteNumber(item?.percent)) {
        return {
          t: item.timeMs,
          pct: roundPct(item.percent),
        };
      }

      return null;
    })
    .filter((item): item is ReportHistoryPoint => item !== null)
    .sort((a, b) => a.t - b.t);
}

/** Computes the signed price-change percent for one position at a mark price. */
function computePnlPercent(
  position: Pick<Position, "direction" | "exposure">,
  price: number,
): number | null {
  const entryPrice = Number(position.exposure.averageEntryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return null;
  }

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const isShort = position.direction === "SHORT";
  const gain = isShort
    ? (entryPrice - price) / entryPrice
    : (price - entryPrice) / entryPrice;

  return roundPct(gain * 100);
}

/** Upserts one PnL-history point, optionally replacing within a time bucket. */
function upsertHistoryPoint(
  history: ReportHistoryPoint[],
  point: ReportHistoryPoint,
  replaceWithinBucket: boolean,
  bucketMs = resolveBucketMs(undefined),
): ReportHistoryPoint[] {
  if (!isFiniteNumber(point.t) || !isFiniteNumber(point.pct)) {
    return history;
  }

  if (history.length === 0) {
    return [point];
  }

  const next = [...history].sort((a, b) => a.t - b.t);
  const last = next.at(-1);
  if (!last) {
    return [point];
  }

  if (replaceWithinBucket) {
    const lastBucket = Math.floor(last.t / bucketMs);
    const nextBucket = Math.floor(point.t / bucketMs);

    if (lastBucket === nextBucket) {
      next[next.length - 1] = point;
    } else if (point.t > last.t) {
      next.push(point);
    }
  } else {
    const existingIndex = next.findIndex((item) => item.t === point.t);
    if (existingIndex >= 0) {
      next[existingIndex] = point;
    } else {
      next.push(point);
    }
  }

  next.sort((a, b) => a.t - b.t);
  if (next.length > MAX_HISTORY_POINTS) {
    return next.slice(next.length - MAX_HISTORY_POINTS);
  }

  return next;
}

/** Ensures a normalized `pnl.history` array exists on the position. */
function ensureReportPosition<T extends Position>(position: T): T {
  position.pnl.history = normalizeHistoryPoints(position.pnl.history);
  return position;
}

/** Gets the round-trip taker fee ratio for one exchange. */
function getRoundTripFeeRatio(exchangeType?: ExchangeType): number {
  if (!exchangeType) {
    return DEFAULT_ROUND_TRIP_FEE_RATIO;
  }

  return (
    getFeeCalculator(exchangeType).getBothSideFeePercent({ type: "taker" }) /
    100
  );
}

/** Applies the fee estimate used by floating PnL. */
function applyFloatingFeeEstimate<T extends Position>(
  position: T,
  roundTripFeeRatio: number,
): T {
  const entryNotional = Number(position.exposure.notionalUsdt) || 0;
  if (!(entryNotional > 0) || !(roundTripFeeRatio > 0)) {
    return position;
  }

  const estimatedTotalFee = entryNotional * roundTripFeeRatio;
  const entryFee =
    isFiniteNumber(position.fees.entryUsdt) && position.fees.entryUsdt >= 0
      ? position.fees.entryUsdt
      : estimatedTotalFee / 2;
  const exitFee = Math.max(0, estimatedTotalFee - entryFee);

  position.fees.entryUsdt = roundUsdt(entryFee);
  position.fees.estimatedExitUsdt = roundUsdt(exitFee);

  return position;
}

/** Applies floating PnL metrics to an open position at a mark price. */
function applyFloatingMetrics<T extends Position>(
  position: T,
  price: number,
  exchangeType?: ExchangeType,
): boolean {
  const roundTripFeeRatio = exchangeType ? getRoundTripFeeRatio(exchangeType) : 0;
  const metrics = computeClosedPositionMetrics(
    position,
    price,
    roundTripFeeRatio,
  );
  if (!metrics) {
    return false;
  }

  position.pnl.netPct = metrics.netProfitPercent;
  position.pnl.netUsdt = metrics.netProfitUSDT;
  // BOTH:POSITION_PNL_USDT_EXTREMA
  applyPositionNetUsdtExtrema(position, metrics.netProfitUSDT);
  position.pnl.currentValueUsdt = metrics.netCurrentUSDT;
  position.pnl.markPrice = price;
  applyFloatingFeeEstimate(position, roundTripFeeRatio);

  return true;
}

/** Recomputes closed-position PnL metrics from the persisted exit price. */
function applyClosedPositionMetrics<T extends Position>(
  position: T,
  roundTripFeeRatio: number,
): T {
  const exitPrice = Number(position.closed?.price);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return position;
  }

  const metrics = computeClosedPositionMetrics(
    position,
    exitPrice,
    roundTripFeeRatio,
  );
  if (!metrics) {
    return position;
  }

  position.pnl.netPct = metrics.netProfitPercent;
  position.pnl.netUsdt = metrics.netProfitUSDT;
  // BOTH:POSITION_PNL_USDT_EXTREMA
  applyPositionNetUsdtExtrema(position, metrics.netProfitUSDT);
  position.pnl.currentValueUsdt = metrics.netCurrentUSDT;

  return position;
}

/** Seeds a deterministic PnL-history series for reporting when none exists. */
function seedSyntheticHistory<T extends Position>(
  position: T,
  roundTripFeeRatio: number,
): T {
  const next = applyClosedPositionMetrics(
    ensureReportPosition(position),
    roundTripFeeRatio,
  );
  let history = [...(next.pnl.history ?? [])];

  if (isFiniteNumber(next.opened.t)) {
    history = upsertHistoryPoint(
      history,
      { t: next.opened.t, pct: 0 },
      false,
    );
  }

  if (isFiniteNumber(next.closed?.t) && isFiniteNumber(next.pnl.netPct)) {
    history = upsertHistoryPoint(
      history,
      { t: next.closed.t!, pct: roundPct(next.pnl.netPct!) },
      false,
    );
  }

  if (history.length === 0 && isFiniteNumber(next.opened.t)) {
    history = [
      {
        t: next.opened.t,
        pct: isFiniteNumber(next.pnl.netPct) ? roundPct(next.pnl.netPct) : 0,
      },
    ];
  }

  next.pnl.history = history;

  const pctValues = history
    .map((item) => item.pct)
    .filter((value): value is number => isFiniteNumber(value));

  if (isFiniteNumber(next.pnl.maxUpPct)) {
    pctValues.push(next.pnl.maxUpPct);
  }
  if (isFiniteNumber(next.pnl.maxDownPct)) {
    pctValues.push(next.pnl.maxDownPct);
  }
  if (isFiniteNumber(next.pnl.netPct)) {
    pctValues.push(next.pnl.netPct);
  }

  if (pctValues.length > 0) {
    next.pnl.maxUpPct = roundPct(Math.max(...pctValues));
    next.pnl.maxDownPct = roundPct(Math.min(...pctValues));
  }

  if (isFiniteNumber(next.pnl.netUsdt)) {
    applyPositionNetUsdtExtrema(next, next.pnl.netUsdt);
  }

  return next;
}

/** Normalizes one position into the shape expected by dashboard reporting. */
function normalizePosition<T extends Position>(
  position: T,
  exchangeType?: ExchangeType,
): T {
  return seedSyntheticHistory(
    { ...position },
    getRoundTripFeeRatio(exchangeType),
  );
}

/** Normalizes positions into the shape expected by dashboard reporting. */
function normalizePositions<T extends Position>(
  positions: T[],
  exchangeType?: ExchangeType,
): T[] {
  return positions.map((position) =>
    normalizePosition(position, exchangeType),
  );
}

/** Appends one floating-PnL observation to a position's history. */
function applyObservation(
  position: Position,
  observation: {
    pct: number;
    timeMs: number;
    replaceWithinBucket: boolean;
    bucketMs?: number;
  },
): void {
  const next = ensureReportPosition(position);
  next.pnl.history = upsertHistoryPoint(
    next.pnl.history ?? [],
    { t: observation.timeMs, pct: roundPct(observation.pct) },
    observation.replaceWithinBucket,
    observation.bucketMs ?? resolveBucketMs(undefined),
  );

  next.pnl.maxUpPct = isFiniteNumber(next.pnl.maxUpPct)
    ? roundPct(Math.max(next.pnl.maxUpPct, observation.pct))
    : roundPct(observation.pct);
  next.pnl.maxDownPct = isFiniteNumber(next.pnl.maxDownPct)
    ? roundPct(Math.min(next.pnl.maxDownPct, observation.pct))
    : roundPct(observation.pct);
}

/** Persists a newer valid perpetual-futures funding snapshot on a position. */
function applyFundingSnapshot(params: {
  exchangeType?: ExchangeType;
  fundingRate?: UnifiedFundingRate;
  position: Position;
}): boolean {
  const { exchangeType, fundingRate, position } = params;
  if (
    !exchangeType ||
    position.tradingMode !== TradingMode.FUTURES ||
    !fundingRate ||
    !isFiniteNumber(fundingRate.rate) ||
    !isFiniteNumber(fundingRate.t) ||
    fundingRate.t <= 0 ||
    (position.funding?.t ?? 0) > fundingRate.t
  ) {
    return false;
  }

  position.funding = {
    exchange: exchangeType,
    rate: fundingRate.rate,
    t: fundingRate.t,
    ...(isFiniteNumber(fundingRate.nextFundingTime) &&
    fundingRate.nextFundingTime > 0
      ? { nextT: fundingRate.nextFundingTime }
      : {}),
  };
  return true;
}

/** Builds the stable key used to attach monitoring diagnostics. */
function makeMonitoringPositionKey(
  symbol: string,
  position: Pick<Position, "opened">,
): string {
  return `${String(symbol || "").trim().toUpperCase()}:${position.opened.t}`;
}

/** Grouped reporting helpers shared by dashboard read models and producers. */
const reporting = {
  history: {
    bucket: {
      defaultMinutes: DEFAULT_HISTORY_BUCKET_MINUTES,
      normalizeMinutes: normalizeBucketMinutes,
      resolveMs: resolveBucketMs,
    },
    normalizePoints: normalizeHistoryPoints,
  },
  pnl: {
    applyObservation,
    applyFloatingMetrics,
    computePercent: computePnlPercent,
  },
  positions: {
    applyFundingSnapshot,
    monitoringKey: makeMonitoringPositionKey,
    normalize: normalizePosition,
    normalizeMany: normalizePositions,
  },
} as const;

export default reporting;
export { reporting };
