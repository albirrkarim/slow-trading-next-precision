import type { VolatilityPoint } from "@/lib/system/types";
import position from "@/lib/system/trading/position";
import type {
  Position,
  RuntimeHistoryPosition,
} from "@/lib/system/trading/types";
import type {
  RuntimeQuickBacktestGrowthPoint,
  RuntimeQuickBacktestMarker,
  RuntimeQuickBacktestResult,
} from "./types";

function getPortfolioValue(
  point: RuntimeQuickBacktestGrowthPoint | undefined,
) {
  if (!point) return 0;
  return point.currentAsset + point.currentSafeHaven;
}

/**
 * Calculates risk-adjusted return from every Quick Backtest equity snapshot.
 * The generic leaderboard Sharpe is monthly, which returns 0 for short visible
 * dashboard ranges; this one is event-return based for `/slow` quick reports.
 */
function calculateQuickSharpeRatio(
  growthOvertime: RuntimeQuickBacktestGrowthPoint[],
) {
  const values = growthOvertime
    .map((point) => getPortfolioValue(point))
    .filter((value) => Number.isFinite(value) && value > 0);
  const returns: number[] = [];

  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous > 0 && current !== previous) {
      returns.push((current - previous) / previous);
    }
  }

  if (returns.length < 2) return 0;

  const average =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - average) ** 2, 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  return Number(((average / stdDev) * Math.sqrt(returns.length)).toFixed(4));
}

function averageNumber(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

/** Format milliseconds into a human readable duration string like "2d 3h 4m". */
function formatExactDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds && parts.length === 0) parts.push(`${seconds}s`);
  return parts.length ? parts.join(" ") : "0s";
}

function formatDuration(ms: number) {
  return Number.isFinite(ms) && ms > 0 ? formatExactDuration(ms) : "—";
}

/**
 * Calculates timeline stretches where simulated capital is active or unused.
 * Each interval is counted once, so active + unused equals the measured
 * backtest window instead of the sum of all position hold durations.
 */
function calculateQuickUnusedCapitalDurationMetrics(
  growthOvertime: RuntimeQuickBacktestGrowthPoint[],
) {
  const points = growthOvertime
    .filter((point) => Number.isFinite(point.timeMs))
    .slice()
    .sort((left, right) => left.timeMs - right.timeMs);
  const activeDurations: number[] = [];
  const unusedDurations: number[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const point = points[index];
    const nextPoint = points[index + 1];
    const duration = nextPoint.timeMs - point.timeMs;
    if (duration <= 0) continue;

    const hasOpenPosition = (point.currentBaseAsset ?? 0) > 0;
    if (hasOpenPosition) activeDurations.push(duration);
    else unusedDurations.push(duration);
  }

  const minActiveCapitalDurationMs = activeDurations.length
    ? Math.min(...activeDurations)
    : 0;
  const totalActiveCapitalDurationMs = activeDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const avgActiveCapitalDurationMs = averageNumber(activeDurations);
  const maxActiveCapitalDurationMs = activeDurations.length
    ? Math.max(...activeDurations)
    : 0;
  const minUnusedCapitalDurationMs = unusedDurations.length
    ? Math.min(...unusedDurations)
    : 0;
  const totalUnusedCapitalDurationMs = unusedDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const avgUnusedCapitalDurationMs = averageNumber(unusedDurations);
  const maxUnusedCapitalDurationMs = unusedDurations.length
    ? Math.max(...unusedDurations)
    : 0;

  return {
    minActiveCapitalDurationMs,
    totalActiveCapitalDurationMs,
    avgActiveCapitalDurationMs,
    maxActiveCapitalDurationMs,
    minActiveCapitalDuration: formatDuration(minActiveCapitalDurationMs),
    totalActiveCapitalDuration: formatDuration(totalActiveCapitalDurationMs),
    avgActiveCapitalDuration: formatDuration(avgActiveCapitalDurationMs),
    maxActiveCapitalDuration: formatDuration(maxActiveCapitalDurationMs),
    minUnusedCapitalDurationMs,
    totalUnusedCapitalDurationMs,
    avgUnusedCapitalDurationMs,
    maxUnusedCapitalDurationMs,
    minUnusedCapitalDuration: formatDuration(minUnusedCapitalDurationMs),
    totalUnusedCapitalDuration: formatDuration(totalUnusedCapitalDurationMs),
    avgUnusedCapitalDuration: formatDuration(avgUnusedCapitalDurationMs),
    maxUnusedCapitalDuration: formatDuration(maxUnusedCapitalDurationMs),
  };
}

/**
 * Calculates the worst adverse price movement while a simulated position was
 * open. This is position drawdown, not whole-portfolio drawdown.
 */
function calculatePositionDrawdownPct({
  position: openPosition,
  volatilityPoints,
}: {
  position: Position;
  volatilityPoints: VolatilityPoint[];
}) {
  const entryPrice = Number(openPosition.exposure.averageEntryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;

  const entryTime = Number(openPosition.opened.t ?? 0);
  const exitTime = Number(openPosition.closed?.t ?? entryTime);
  const heldPrices = volatilityPoints
    .filter((point) => point.t >= entryTime && point.t <= exitTime)
    .map((point) => Number(point.p))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (Number.isFinite(Number(openPosition.closed?.price))) {
    heldPrices.push(Number(openPosition.closed?.price));
  }

  if (heldPrices.length === 0) return 0;

  if (openPosition.direction === "SHORT") {
    const maxPrice = Math.max(...heldPrices);
    return Math.max(0, ((maxPrice - entryPrice) / entryPrice) * 100);
  }

  const minPrice = Math.min(...heldPrices);
  return Math.max(0, ((entryPrice - minPrice) / entryPrice) * 100);
}

/**
 * Summarizes position-level risk and holding duration across closed simulated
 * positions.
 */
function calculateQuickPositionMetrics({
  positionsBySymbol,
  volatilityMap,
}: {
  positionsBySymbol: Record<string, Position[]>;
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const drawdowns: number[] = [];
  const holdDurations: number[] = [];

  for (const [symbol, positions] of Object.entries(positionsBySymbol)) {
    for (const openPosition of positions) {
      drawdowns.push(
        calculatePositionDrawdownPct({
          position: openPosition,
          volatilityPoints: volatilityMap[symbol] ?? [],
        }),
      );

      const holdDuration =
        (openPosition.closed?.t ?? 0) > openPosition.opened.t
          ? (openPosition.closed?.t ?? 0) - openPosition.opened.t
          : 0;
      if (Number.isFinite(holdDuration) && holdDuration > 0) {
        holdDurations.push(holdDuration);
      }
    }
  }

  const minHoldDurationMs = holdDurations.length
    ? Math.min(...holdDurations)
    : 0;
  const maxHoldDurationMs = holdDurations.length
    ? Math.max(...holdDurations)
    : 0;
  const totalHoldDurationMs = holdDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const avgHoldDurationMs = holdDurations.length
    ? holdDurations.reduce((total, item) => total + item, 0) /
      holdDurations.length
    : 0;

  return {
    maxPositionDrawdownPct: drawdowns.length ? Math.max(...drawdowns) : 0,
    minHoldDurationMs,
    totalHoldDurationMs,
    avgHoldDurationMs,
    maxHoldDurationMs,
    minHoldDuration: formatDuration(minHoldDurationMs),
    totalHoldDuration: formatDuration(totalHoldDurationMs),
    avgHoldDuration: formatDuration(avgHoldDurationMs),
    maxHoldDuration: formatDuration(maxHoldDurationMs),
  };
}

/**
 * Converts balance snapshots into the small chart series shape used by the
 * dashboard growth chart.
 */
function growthOvertimeToQuickSeries(
  growthOvertime: RuntimeQuickBacktestGrowthPoint[],
): RuntimeQuickBacktestResult["growthOvertimeSeries"] {
  const points = growthOvertime.map((point) => ({
    ...point,
    timeSec: Math.floor(point.timeMs / 1000),
  }));

  return {
    names: [
      "Current Balance",
      "Spendable Balance",
      "Reserved Balance",
      "Current Asset",
      "Current Asset Floating",
      "Current Safe Haven",
    ],
    series: [
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentBalance,
      })),
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentSpendableBalance ?? point.currentBalance,
      })),
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentReservedBalance ?? 0,
      })),
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentAsset,
      })),
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentAssetFloating,
      })),
      points.map((point) => ({
        time: point.timeSec,
        level: point.currentSafeHaven,
      })),
    ],
  };
}

/** Normalizes a marker level while preserving the chart's real vPoint scale. */
function getFiniteLevel(value: unknown, fallback = 0) {
  const level = Number(value);
  return Number.isFinite(level) ? level : fallback;
}

function makeSimulationEntryMarker(
  openPosition: Position,
): RuntimeQuickBacktestMarker {
  return {
    time: Math.floor((openPosition.opened.t ?? 0) / 1000),
    level: getFiniteLevel(openPosition.opened.vPoint.lvl),
    color: openPosition.direction === "SHORT" ? "#dc2626" : "#16a34a",
    text:
      `TRADE SIMULATION ENTRY ${openPosition.symbol ?? ""} ` +
      `L${openPosition.opened.vPoint.lvl ?? 0} ${openPosition.direction ?? ""} ` +
      `$${(openPosition.exposure.notionalUsdt ?? 0).toFixed(2)} @ ${openPosition.exposure.averageEntryPrice}`,
  };
}

function makeSimulationExitMarker(
  openPosition: Position,
): RuntimeQuickBacktestMarker {
  return {
    time: Math.floor(
      (openPosition.closed?.t ?? openPosition.opened.t) / 1000,
    ),
    level: getFiniteLevel(
      openPosition.closed?.vPoint?.lvl,
      getFiniteLevel(openPosition.opened.vPoint.lvl),
    ),
    color: (openPosition.pnl.netUsdt ?? 0) >= 0 ? "#2563eb" : "#f97316",
    text:
      `TRADE SIMULATION EXIT ${openPosition.symbol ?? ""} ` +
      `L${openPosition.closed?.vPoint?.lvl ?? openPosition.opened.vPoint.lvl} ` +
      `$${(openPosition.pnl.netUsdt ?? 0).toFixed(2)} ` +
      `${(openPosition.pnl.netPct ?? 0).toFixed(2)}% @ ${openPosition.closed?.price ?? "?"}`,
  };
}

function makeSimulationAveragingMarkers(
  openPosition: Position,
): RuntimeQuickBacktestMarker[] {
  const triggers = openPosition.strategy.averaging.executions ?? [];
  const entryLevel = getFiniteLevel(openPosition.opened.vPoint.lvl);

  return triggers
    .filter((trigger) => Number.isFinite(trigger.t))
    .map((trigger) => ({
      time: Math.floor(trigger.t / 1000),
      level: getFiniteLevel(trigger.level, entryLevel),
      color: "#7c3aed",
      text:
        `TRADE SIMULATION AVG ${openPosition.symbol ?? ""} ` +
        `L${trigger.level} ` +
        `$${trigger.marginUsdt.toFixed(2)} @ ${trigger.price}`,
    }));
}

/**
 * Builds entry/averaging/exit marker lines for the Volatility Points chart.
 */
function positionsToQuickSimulationSeries(
  positionsBySymbol: Record<string, Position[]>,
): RuntimeQuickBacktestResult["simulationSeries"] {
  const names: string[] = [];
  const series: RuntimeQuickBacktestMarker[][] = [];

  for (const [symbol, positions] of Object.entries(positionsBySymbol)) {
    for (const openPosition of positions) {
      names.push(`TRADE SIMULATION ${symbol}`);
      series.push([
        makeSimulationEntryMarker(openPosition),
        makeSimulationExitMarker(openPosition),
      ]);

      for (const averagingMarker of makeSimulationAveragingMarkers(
        openPosition,
      )) {
        names.push(`TRADE SIMULATION ${symbol}`);
        series.push([averagingMarker]);
      }
    }
  }

  return { names, series };
}

/**
 * Calculates unlevered PnL percent for a position at a rail price.
 */
function calculateQuickPositionPnlPct(
  openPosition: Position,
  price: number,
) {
  const entryPrice = Number(openPosition.exposure.averageEntryPrice);
  const currentPrice = Number(price);
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return null;
  }

  const rawPct =
    openPosition.direction === "SHORT"
      ? ((entryPrice - currentPrice) / entryPrice) * 100
      : ((currentPrice - entryPrice) / entryPrice) * 100;

  return Number(rawPct.toFixed(3));
}

/**
 * Builds per-trade PnL history from the detected volatility rail so the shared
 * trade-history table can show max run-up and max drawdown for Quick Backtest.
 */
function buildQuickPositionPnlHistory({
  position: openPosition,
  volatilityPoints,
}: {
  position: Position;
  volatilityPoints: VolatilityPoint[];
}): NonNullable<RuntimeHistoryPosition["pnl"]["history"]> {
  const entryTime = Number(openPosition.opened.t ?? 0);
  const exitTime = Number(openPosition.closed?.t ?? entryTime);
  const points = volatilityPoints
    .filter((point) => point.t >= entryTime && point.t <= exitTime)
    .map((point) => ({
      t: point.t,
      pct: calculateQuickPositionPnlPct(openPosition, point.p),
    }))
    .filter(
      (point): point is { t: number; pct: number } =>
        Number.isFinite(point.t) && point.pct !== null,
    );

  const entryPct = calculateQuickPositionPnlPct(
    openPosition,
    openPosition.exposure.averageEntryPrice,
  );
  if (Number.isFinite(entryTime) && entryPct !== null) {
    points.push({ t: entryTime, pct: entryPct });
  }

  if (
    Number.isFinite(exitTime) &&
    Number.isFinite(Number(openPosition.pnl.netPct))
  ) {
    points.push({
      t: exitTime,
      pct: Number(Number(openPosition.pnl.netPct).toFixed(3)),
    });
  } else if (
    Number.isFinite(exitTime) &&
    Number.isFinite(Number(openPosition.closed?.price))
  ) {
    const exitPct = calculateQuickPositionPnlPct(
      openPosition,
      Number(openPosition.closed?.price),
    );
    if (exitPct !== null) {
      points.push({ t: exitTime, pct: exitPct });
    }
  }

  const byTime = new Map<number, number>();
  for (const point of points) {
    byTime.set(point.t, point.pct);
  }

  return Array.from(byTime.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([t, pct]) => ({ t, pct }));
}

/**
 * Flattens closed simulated positions into the SLOW history table row shape.
 */
function positionsToQuickTradeHistory(
  positionsBySymbol: Record<string, Position[]>,
  volatilityMap: Record<string, VolatilityPoint[]> = {},
): RuntimeHistoryPosition[] {
  return Object.entries(positionsBySymbol)
    .flatMap(([symbol, positions]) =>
      positions.map((openPosition) => {
        const normalizedSymbol = (
          openPosition.symbol ?? symbol
        ).toUpperCase();
        const intermediateVPoints =
          openPosition.vPoints ??
          position.vPoints.intermediate({
            position: openPosition,
            volatilityPoints: volatilityMap[normalizedSymbol] ?? [],
          });
        const history = buildQuickPositionPnlHistory({
          position: openPosition,
          volatilityPoints: volatilityMap[normalizedSymbol] ?? [],
        });
        const pctValues = history
          .map((point) => point.pct)
          .filter((value) => Number.isFinite(value));
        const usdtValues = [
          openPosition.pnl.maxUpUsdt,
          openPosition.pnl.maxDownUsdt,
          openPosition.pnl.netUsdt,
        ].filter((value): value is number => Number.isFinite(value));

        return {
          ...openPosition,
          executionMode: "sandbox" as const,
          mode: "sandbox" as const,
          ...(intermediateVPoints !== undefined && {
            vPoints: intermediateVPoints,
          }),
          pnl: {
            ...openPosition.pnl,
            history,
            maxDownPct: pctValues.length ? Math.min(...pctValues) : 0,
            maxUpPct: pctValues.length ? Math.max(...pctValues) : 0,
            // BOTH:POSITION_PNL_USDT_EXTREMA
            maxDownUsdt: usdtValues.length ? Math.min(...usdtValues) : 0,
            maxUpUsdt: usdtValues.length ? Math.max(...usdtValues) : 0,
          },
          symbol: normalizedSymbol,
        };
      }),
    )
    .sort((left, right) => (right.closed?.t ?? 0) - (left.closed?.t ?? 0));
}

/**
 * Combines sparse account growth series using the latest value per timestamp.
 * Each account's last known value is carried forward until its next snapshot.
 */
function combineQuickGrowthSeries(
  accountResults: Array<{
    result: Pick<RuntimeQuickBacktestResult, "growthOvertimeSeries">;
  }>,
): RuntimeQuickBacktestResult["growthOvertimeSeries"] {
  const names = accountResults[0]?.result.growthOvertimeSeries.names ?? [];
  return {
    names,
    series: names.map((_, seriesIndex) => {
      const pointsByAccount = accountResults.map((account) => {
        const latestByTime = new Map<number, RuntimeQuickBacktestMarker>();
        for (const point of
          account.result.growthOvertimeSeries.series[seriesIndex] ?? []) {
          if (Number.isFinite(point.time) && Number.isFinite(point.level)) {
            latestByTime.set(point.time, point);
          }
        }

        return [...latestByTime.values()].sort(
          (left, right) => left.time - right.time,
        );
      });
      const times = [
        ...new Set(
          pointsByAccount.flatMap((points) =>
            points.map((point) => point.time),
          ),
        ),
      ].sort((left, right) => left - right);
      const cursors = pointsByAccount.map(() => 0);
      const latestLevels = pointsByAccount.map(() => 0);

      // BTEST:MULTI_ACCOUNT_COMBINED_BACKTEST
      return times.map((time) => {
        pointsByAccount.forEach((points, accountIndex) => {
          while (
            cursors[accountIndex] < points.length &&
            points[cursors[accountIndex]].time <= time
          ) {
            latestLevels[accountIndex] =
              points[cursors[accountIndex]].level;
            cursors[accountIndex] += 1;
          }
        });

        return {
          time,
          level: latestLevels.reduce((total, level) => total + level, 0),
        };
      });
    }),
  };
}

/** Combines account markers under the chart's single TRADE SIMULATION group. */
function combineQuickSimulationSeries(
  accountResults: Array<{
    name: string;
    result: Pick<RuntimeQuickBacktestResult, "simulationSeries">;
  }>,
): RuntimeQuickBacktestResult["simulationSeries"] {
  // BTEST:MULTI_ACCOUNT_COMBINED_BACKTEST
  return {
    names: accountResults.flatMap(
      (account) => account.result.simulationSeries.names,
    ),
    series: accountResults.flatMap((account) =>
      account.result.simulationSeries.series.map((markers) =>
        markers.map((marker) => ({
          ...marker,
          text: marker.text
            ? `${account.name}: ${marker.text}`
            : marker.text,
        })),
      ),
    ),
  };
}

const quickBacktestReport = {
  combineGrowthSeries: combineQuickGrowthSeries,
  combineSimulationSeries: combineQuickSimulationSeries,
  growthSeries: growthOvertimeToQuickSeries,
  metrics: {
    positionDrawdownPct: calculatePositionDrawdownPct,
    positions: calculateQuickPositionMetrics,
    portfolioValue: getPortfolioValue,
    sharpeRatio: calculateQuickSharpeRatio,
    unusedCapital: calculateQuickUnusedCapitalDurationMetrics,
  },
  simulationSeries: positionsToQuickSimulationSeries,
  tradeHistory: positionsToQuickTradeHistory,
  formatDuration,
} as const;

export default quickBacktestReport;
export { quickBacktestReport };
