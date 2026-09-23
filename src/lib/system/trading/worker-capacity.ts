import type { Position } from "./types";
import reserve from "./reserve";

export interface RuntimeWorkerCapacity {
  availableWorkers: number;
  balanceAvailableWorkers: number;
  bailoutBufferUsdt: number;
  currentOpenPositions: number;
  entryBudgetUsdt: number;
  entryMarginUsdt: number;
  entrySpareBufferUsdt: number;
  existingBailoutBufferUsdt: number;
  maxOpenPositions: number;
  projectedBailoutBufferUsdt: number;
  remainingPositionSlots: number | null;
  spendableUsdt: number;
  workerCostUsdt: number;
}

export interface RuntimeWorkerCapacityConfig {
  enableWatchLogic?: boolean;
  entrySpareBufferEnabled?: boolean;
  maxEntryMargin?: number;
  maxEntryMarginPct?: number;
  maxOpenPositions?: number;
  watchMaxNextAveragingLevels?: number;
  watchReserveLevels?: number;
  watchReservePctAlloc?: number;
}

interface CapacityPartsParams {
  entryMarginUsdt: number;
  existingBailoutBufferUsdt: number;
  maxNextLevels: number;
  pctAlloc: number;
  requiredMultiplier: number;
  reserveLevels: number;
  spendableUsdt: number;
  watchEnabled: boolean;
}

/** Resolves the configured maximum to a non-negative integer. */
function resolveMaxOpenPositions(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

/** Builds the derived worker costs for a candidate entry margin. */
function buildCapacityParts(params: CapacityPartsParams) {
  const workerCostUsdt = reserve.money.roundUsdt(
    params.entryMarginUsdt * params.requiredMultiplier,
  );
  const projectedWatchState = params.watchEnabled
    ? reserve.state.build({
        baseMarginUsdt: params.entryMarginUsdt,
        direction: "LONG",
        entryLevel: 0,
        maxNextLevels: params.maxNextLevels,
        pctAlloc: params.pctAlloc,
        reserveLevels: params.reserveLevels,
      })
    : undefined;
  const projectedBailoutBufferUsdt =
    reserve.balance.getLargestUnreservedStateStepMarginUsdt(
      projectedWatchState,
    );
  const bailoutBufferUsdt = reserve.money.roundUsdt(
    Math.max(
      params.existingBailoutBufferUsdt,
      projectedBailoutBufferUsdt,
    ),
  );
  const entryBudgetUsdt = Math.max(0, params.spendableUsdt - bailoutBufferUsdt);

  return {
    bailoutBufferUsdt,
    entryBudgetUsdt,
    projectedBailoutBufferUsdt,
    workerCostUsdt,
  };
}

/**
 * Shrinks an uncapped preview margin until one worker preserves bailout cash.
 */
function fitPreviewMarginToBailoutBuffer(
  params: CapacityPartsParams,
): number {
  if (params.entryMarginUsdt <= 0) {
    return 0;
  }

  const currentParts = buildCapacityParts(params);
  if (currentParts.workerCostUsdt <= currentParts.entryBudgetUsdt) {
    return reserve.money.roundUsdt(params.entryMarginUsdt);
  }

  let low = 0;
  let high = params.entryMarginUsdt;
  for (let i = 0; i < 40; i += 1) {
    const midpoint = (low + high) / 2;
    const candidateParts = buildCapacityParts({
      ...params,
      entryMarginUsdt: midpoint,
    });

    if (candidateParts.workerCostUsdt <= candidateParts.entryBudgetUsdt) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return reserve.money.roundUsdt(low);
}

/**
 * Calculates how many new entry workers the current balance can afford.
 */
function calculateRuntimeWorkerCapacity(params: {
  activePositions: Array<Pick<Position, "strategy">>;
  config: RuntimeWorkerCapacityConfig;
  spendableUsdt: number;
}): RuntimeWorkerCapacity {
  const { activePositions, config } = params;
  const spendableUsdt = Math.max(0, params.spendableUsdt);
  const existingBailoutBufferUsdt =
    reserve.balance.getLargestUnreservedStepMarginUsdt(activePositions);
  const sizingBudgetUsdt = Math.max(
    0,
    spendableUsdt - existingBailoutBufferUsdt,
  );
  const watchEnabled = config.enableWatchLogic !== false;
  const reserveLevels = watchEnabled ? config.watchReserveLevels ?? 2 : 0;
  const maxNextLevels = watchEnabled
    ? config.watchMaxNextAveragingLevels ?? reserveLevels
    : 0;
  const pctAlloc = config.watchReservePctAlloc ?? 2;
  const initialEntryMarginUsdt = reserve.entry.adjustMarginForConfig({
    desiredMarginUsdt: sizingBudgetUsdt,
    spendableUsdt: sizingBudgetUsdt,
    enableWatchLogic: watchEnabled,
    entrySpareBufferEnabled: config.entrySpareBufferEnabled !== false,
    reserveLevels,
    pctAlloc,
    maxEntryMarginPct: config.maxEntryMarginPct ?? 0,
    maxEntryMargin: config.maxEntryMargin ?? 0,
  });
  const requiredMultiplier = watchEnabled
    ? reserve.entry.getRequiredMarginMultiplier({
        reserveLevels,
        pctAlloc,
      })
    : 1;
  const hasFixedEntryMarginCap =
    Number.isFinite(config.maxEntryMargin) &&
    (config.maxEntryMargin ?? 0) > 0;
  const entryMarginUsdt = hasFixedEntryMarginCap
    ? initialEntryMarginUsdt
    : fitPreviewMarginToBailoutBuffer({
        entryMarginUsdt: initialEntryMarginUsdt,
        existingBailoutBufferUsdt,
        maxNextLevels,
        pctAlloc,
        requiredMultiplier,
        reserveLevels,
        spendableUsdt,
        watchEnabled,
      });
  const entrySpareBufferUsdt =
    watchEnabled &&
    reserveLevels > 0 &&
    Number.isFinite(pctAlloc) &&
    pctAlloc > 0 &&
    config.entrySpareBufferEnabled !== false
      ? entryMarginUsdt
      : 0;
  const {
    bailoutBufferUsdt,
    entryBudgetUsdt,
    projectedBailoutBufferUsdt,
    workerCostUsdt,
  } = buildCapacityParts({
    entryMarginUsdt,
    existingBailoutBufferUsdt,
    maxNextLevels,
    pctAlloc,
    requiredMultiplier,
    reserveLevels,
    spendableUsdt,
    watchEnabled,
  });
  const balanceAvailableWorkers =
    entryMarginUsdt >= reserve.constants.minimalUsdtToTrade &&
    workerCostUsdt > 0
      ? Math.floor(entryBudgetUsdt / workerCostUsdt)
      : 0;
  const maxOpenPositions = resolveMaxOpenPositions(config.maxOpenPositions);
  const currentOpenPositions = activePositions.length;
  const remainingPositionSlots =
    maxOpenPositions > 0
      ? Math.max(0, maxOpenPositions - currentOpenPositions)
      : null;
  const availableWorkers =
    remainingPositionSlots === null
      ? balanceAvailableWorkers
      : Math.min(balanceAvailableWorkers, remainingPositionSlots);

  return {
    availableWorkers,
    balanceAvailableWorkers,
    bailoutBufferUsdt,
    currentOpenPositions,
    entryBudgetUsdt,
    entryMarginUsdt,
    entrySpareBufferUsdt,
    existingBailoutBufferUsdt,
    maxOpenPositions,
    projectedBailoutBufferUsdt,
    remainingPositionSlots,
    spendableUsdt,
    workerCostUsdt,
  };
}

/**
 * Grouped worker-capacity API for production, backtest, and UI callers.
 */
const runtimeWorkerCapacity = {
  calculate: calculateRuntimeWorkerCapacity,
} as const;

export default runtimeWorkerCapacity;
export { runtimeWorkerCapacity };
