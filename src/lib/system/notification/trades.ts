import type {
  RuntimeContext,
  RuntimeDecision,
} from "@/lib/precision/types";
import type { RuntimeMode } from "../runtime/types";
import type { Position } from "../trading/types";
import systemNotif from "./index";

const FAILED_TITLES: Record<RuntimeDecision["type"], string> = {
  averaging: "AVERAGING ORDER FAILED",
  entry: "BUY ORDER FAILED",
  exit: "EXIT ORDER FAILED",
};

const SUCCESS_KEYS: Record<RuntimeDecision["type"], string> = {
  averaging: "NOTIF_AVERAGE",
  entry: "NOTIF_ENTRY",
  exit: "NOTIF_EXIT",
};

const FAILED_KEYS: Record<RuntimeDecision["type"], string> = {
  averaging: "NOTIF_AVERAGE_FAILED",
  entry: "NOTIF_ENTRY_FAILED",
  exit: "NOTIF_EXIT_FAILED",
};

function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

function modePrefix(mode: RuntimeMode): string {
  return mode === "sandbox" ? "[SANDBOX] " : "";
}

function formatPrice(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(5)}`
    : "-";
}

function formatUsdt(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "-";
}

/** Builds the success title for one executed trade decision. */
function buildSuccessTitle(params: {
  decision: RuntimeDecision;
  exchangeType: string;
  mode: RuntimeMode;
  position: Position;
}): string {
  const { position } = params;
  const symbol = normalizeSymbol(position.symbol);
  const prefix = modePrefix(params.mode);

  if (params.decision.type === "entry") {
    return (
      `${prefix}[ENTRY] | ${symbol} ${position.direction} | ` +
      `USDT: ${formatUsdt(position.exposure.marginUsdt)} @ ` +
      `Price: ${formatPrice(position.opened.price)} | ` +
      `Quantity: ${position.exposure.quantity} | ` +
      `Leverage: ${position.exposure.leverage}x | ` +
      `${params.exchangeType}:${position.tradingMode}`
    );
  }

  if (params.decision.type === "averaging") {
    const execution = position.strategy.averaging.executions?.at(-1);
    return (
      `${prefix}[ADD POSITION] | ${symbol} ${position.direction} | ` +
      `Level ${execution?.level ?? "-"} | ` +
      `Margin: ${formatUsdt(execution?.marginUsdt)} @ ` +
      `${formatPrice(execution?.price)}`
    );
  }

  const netUsdt = position.pnl.netUsdt ?? 0;
  const totalFees =
    (position.fees.entryUsdt ?? 0) + (position.closed?.feeUsdt ?? 0);
  const grossUsdt = netUsdt + totalFees;
  return (
    `${prefix}[SELL] | ${symbol} ${position.direction} | ` +
    `Profit: ${formatUsdt(grossUsdt)} | ` +
    `USDT Profit: ${formatUsdt(netUsdt)} | ` +
    `Entry: ${formatPrice(position.exposure.averageEntryPrice)} ` +
    `Current: ${formatPrice(position.closed?.price)} | ` +
    `Gain: ${(position.pnl.netPct ?? 0).toFixed(2)}%`
  );
}

/** Builds the dedupe identity for one executed trade decision. */
function buildExecutedDedupeKey(params: {
  decision: RuntimeDecision;
  mode: RuntimeMode;
  position: Position;
}): string {
  const { decision, mode, position } = params;
  const base = [
    "slow-trade",
    decision.type,
    mode,
    decision.accountSlug,
    normalizeSymbol(decision.symbol),
    position.opened.t,
  ];

  if (decision.type === "averaging") {
    const execution = position.strategy.averaging.executions?.at(-1);
    base.push(String(execution?.t ?? ""), String(execution?.level ?? ""));
  } else if (decision.type === "exit") {
    base.push(String(position.closed?.t ?? ""));
  }

  return base.join(":");
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Reports one executed trade action (entry, averaging, or exit) through the
 * configured notification channels. No-op when the environment's `onNotif`
 * gate disables notification delivery.
 */
async function executed(params: {
  context: RuntimeContext;
  decision: RuntimeDecision;
  mode: RuntimeMode;
  position: Position;
}): Promise<void> {
  if (params.context.adapter.onNotif?.() === false) return;

  const { decision, mode, position } = params;
  const sandbox = mode === "sandbox";
  await systemNotif.central({
    dashboard: "SLOW",
    dedupeKey: buildExecutedDedupeKey({ decision, mode, position }),
    key: SUCCESS_KEYS[decision.type],
    message: JSON.stringify(
      {
        decision: {
          accountSlug: decision.accountSlug,
          emailNotif:
            decision.type === "exit"
              ? decision.tradeDecision.emailNotif
              : undefined,
          message: decision.message,
          symbol: decision.symbol,
          type: decision.type,
        },
        position: {
          closed: position.closed,
          direction: position.direction,
          exposure: position.exposure,
          opened: position.opened,
          pnl: position.pnl,
        },
        sandbox,
      },
      null,
      2,
    ),
    title: buildSuccessTitle({
      decision,
      exchangeType: params.context.state.config.management.exchangeType,
      mode,
      position,
    }),
  });
}

/**
 * Reports one attempted trade action that produced no executed position —
 * exchange rejection, confirmation failure, or validation returning no plan.
 */
async function failed(params: {
  context: RuntimeContext;
  decision: RuntimeDecision;
  error: unknown;
  mode: RuntimeMode;
}): Promise<void> {
  if (params.context.adapter.onNotif?.() === false) return;

  const { decision, mode } = params;
  const sandbox = mode === "sandbox";
  await systemNotif.central({
    dashboard: "SLOW",
    dedupeKey: [
      "slow-trade-failed",
      decision.type,
      mode,
      decision.accountSlug,
      normalizeSymbol(decision.symbol),
      params.context.state.currentTime,
    ].join(":"),
    key: FAILED_KEYS[decision.type],
    message: JSON.stringify(
      {
        decision: {
          accountSlug: decision.accountSlug,
          message: decision.message,
          symbol: decision.symbol,
          type: decision.type,
        },
        error: describeError(params.error),
        sandbox,
      },
      null,
      2,
    ),
    title: FAILED_TITLES[decision.type],
  });
}

/** Grouped trade-execution notification API. */
const tradeNotif = {
  executed,
  failed,
} as const;

export default tradeNotif;
export { tradeNotif };
