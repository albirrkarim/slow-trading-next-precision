import binanceRequestCoordinator from "@/lib/exchange/platform/binance/request-coordinator";
import monitoring from "@/lib/precision/monitoring";
import type {
  RuntimeContext,
  RuntimeStageRunPatch,
} from "@/lib/precision/types";
import { systemNotif } from "@/lib/system/notification";
import { systemLog } from "@/lib/system/logging";
import {
  getChannelsForNotification,
  getNotificationTypeConfig,
  type NotificationChannel,
} from "@/lib/system/notification/config";
import type {
  RuntimeMode,
  RuntimeStage,
  RuntimeStageRunStats,
} from "@/lib/system/runtime";
import {
  runtimeBalanceSnapshots,
  runtimeStorage,
} from "@/lib/system/storage";
import blackSwan, {
  type BlackSwanConfig,
  type BlackSwanState,
} from "@/lib/system/trading/black-swan";
import runtimeDailyPerformance from "@/lib/system/trading/daily-performance";
import runtimeDailyPnlLimit from "@/lib/system/trading/daily-pnl-limit";

const SENTINEL_LOOKBACK_MINUTES = 65;
const BREADTH_FETCH_CONCURRENCY = 4;

const NOTIFICATION_CHANNELS: NotificationChannel[] = ["telegram", "email"];

function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

function modeOf(context: RuntimeContext): RuntimeMode {
  return context.state.mode === "sandbox" ? "sandbox" : "live";
}

/** Fetches closed 1m candles for one symbol through the environment market port. */
async function getCandles(
  context: RuntimeContext,
  symbol: string,
  currentTimeMs: number,
) {
  const marketType =
    context.state.config.management.tradingMode === "futures"
      ? "FUTURES"
      : "SPOT";
  return context.adapter.market.getKlines({
    endTime: currentTimeMs,
    interval: "1m",
    marketType,
    minutes: SENTINEL_LOOKBACK_MINUTES,
    symbol: `${normalizeSymbol(symbol)}_USDT`,
  });
}

/** Runs limited-concurrency breadth fetches; failed symbols are excluded. */
async function getBreadthCandles(
  context: RuntimeContext,
  symbols: string[],
  currentTimeMs: number,
) {
  const output: Record<string, Awaited<ReturnType<typeof getCandles>>> = {};
  const queue = Array.from(
    new Set(symbols.map(normalizeSymbol).filter(Boolean)),
  ).filter((symbol) => symbol !== "BTC");
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(BREADTH_FETCH_CONCURRENCY, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const symbol = queue[cursor++];
          try {
            output[symbol] = await getCandles(context, symbol, currentTimeMs);
          } catch (error) {
            if (binanceRequestCoordinator.error.isRateLimit(error)) {
              throw error;
            }
            // Missing symbols stay out of the valid breadth denominator.
          }
        }
      },
    ),
  );

  return output;
}

/** Mirrors the legacy pre-check: BTC drawdown breached either warning level. */
function isBtcWarning(
  state: BlackSwanState,
  config: BlackSwanConfig,
): boolean {
  return (
    (state.evidence?.btc[5]?.pct ?? 0) <=
      -config.btcWarning.fiveMinuteDrawdownPct ||
    (state.evidence?.btc[15]?.pct ?? 0) <=
      -config.btcWarning.fifteenMinuteDrawdownPct
  );
}

/** Sends one transition-level notification for portfolio crash protection. */
async function notifyBlackSwanTransition(params: {
  emergencyExits: string[];
  mode: RuntimeMode;
  next: BlackSwanState;
  notification: RuntimeContext["state"]["config"]["runtime"]["notification"];
  previous: BlackSwanState;
}) {
  const stateChanged = params.previous.status !== params.next.status;
  const exits = Array.from(new Set(params.emergencyExits));
  if (!stateChanged && exits.length === 0) return;

  const btc = params.next.evidence?.btc;
  for (const channel of getChannelsForNotification(
    params.notification,
    "NOTIF_BLACK_SWAN_ACTION",
  )) {
    await systemNotif.central({
      channel,
      dashboard: "SLOW",
      dedupeKey: [
        "slow-black-swan",
        channel,
        params.mode,
        params.next.status,
        params.next.since,
        exits.join(","),
      ].join(":"),
      // PROD:NOTIF_BLACK_SWAN_ACTION
      key: "NOTIF_BLACK_SWAN_ACTION",
      message: [
        `State: ${params.previous.status} -> ${params.next.status}`,
        `Reason: ${params.next.reason}`,
        `BTC 5m: ${btc?.[5]?.pct?.toFixed(2) ?? "-"}%`,
        `BTC 15m: ${btc?.[15]?.pct?.toFixed(2) ?? "-"}%`,
        `BTC 60m: ${btc?.[60]?.pct?.toFixed(2) ?? "-"}%`,
        `Breadth: ${params.next.evidence?.breadth?.pct?.toFixed(1) ?? "-"}% (${params.next.evidence?.breadth?.affected ?? 0}/${params.next.evidence?.breadth?.valid ?? 0})`,
        `Emergency exits: ${exits.length > 0 ? exits.join(", ") : "none"}`,
        `Time: ${new Date(params.next.t).toISOString()}`,
      ].join("\n"),
      title: `[BLACK SWAN] ${params.next.status} (${params.mode.toUpperCase()})`,
    });
  }
}

/**
 * Risk-sentinel stage: captures BTC drawdown evidence once, escalates to
 * market breadth only on warning, persists the mode state, marks
 * emergency exits on protected positions, and notifies transitions.
 */
async function runRiskSentinel(
  context: RuntimeContext,
): Promise<RuntimeStageRunPatch> {
  const now = context.state.currentTime;
  const mode = modeOf(context);
  const config = blackSwan.config.normalize(
    context.state.config.management.blackSwan,
  );

  const status = await runtimeStorage.status.load(mode);
  const previous = blackSwan.state.normalize(status.blackSwan, now);

  let btcCandles: Awaited<ReturnType<typeof getCandles>> = [];
  try {
    btcCandles = config.enabled
      ? await getCandles(context, "BTC", now)
      : [];
  } catch (error) {
    if (binanceRequestCoordinator.error.isRateLimit(error)) {
      throw error;
    }
    // The pure detector converts stale BTC data into a fail-closed WATCH.
  }

  const firstPass = blackSwan.detector.evaluate({
    btcCandles,
    config,
    currentTimeMs: now,
    mode,
    previous,
  });
  const breadthCandlesBySymbol =
    config.enabled && isBtcWarning(firstPass, config)
      ? await getBreadthCandles(
          context,
          context.state.config.management.symbols,
          now,
        )
      : undefined;

  const next = blackSwan.detector.evaluate({
    breadthCandlesBySymbol,
    btcCandles,
    config,
    currentTimeMs: now,
    mode,
    previous,
  });

  // Emergency exits: flag the positions selected by the configured crisis
  // policy, then let the shared monitor run the normal exit pipeline.
  const emergencyExits: string[] = [];
  if (next.status === "CRISIS" && config.exitPolicy !== "FREEZE_ONLY") {
    for (const position of [...context.state.openPositions]) {
      if (position.closed) continue;
      const shouldClose = blackSwan.emergency.shouldClose({
        direction: position.direction,
        exitPolicy: config.exitPolicy,
        tradingMode: String(context.state.config.management.tradingMode),
      });
      if (!shouldClose) continue;

      position.control = {
        ...position.control,
        forceExit: { reason: `BLACK_SWAN:${next.reason}` },
      };
      await monitoring.position.monitor(context, position);
      if (!context.state.openPositions.includes(position)) {
        emergencyExits.push(normalizeSymbol(position.symbol));
      }
    }
  }

  await runtimeStorage.status.update(mode, (current) => {
    current.blackSwan = next;
  });

  await notifyBlackSwanTransition({
    emergencyExits,
    mode,
    next,
    notification: context.state.config.runtime.notification,
    previous,
  });

  return {
    reports: emergencyExits.length,
    summary:
      `${mode} risk sentinel ${next.status} (${next.reason})` +
      ` | emergency exits ${emergencyExits.length}`,
    symbols:
      1 + Object.keys(breadthCandlesBySymbol ?? {}).length,
  };
}

function formatSignedUsdt(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatBalanceUsdt(value: number | null): string {
  return value === null ? "-" : `$${value.toFixed(2)}`;
}

function formatDailyTitleDay(day: string): string {
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][Number(day.slice(5, 7)) - 1];

  return `${Number(day.slice(8, 10))} ${month ?? ""}`.trim();
}

/**
 * Daily-PnL entry-stop notification: one per channel per breach, re-armed
 * whenever the evaluation drops back below the threshold. A channel is only
 * marked after its send succeeds so a delivery failure retries next pass.
 */
async function notifyDailyPnlLimit(params: {
  currentTimeMs: number;
  evaluation: ReturnType<typeof runtimeDailyPnlLimit.guard.evaluatePnl>;
  mode: RuntimeMode;
  notification: RuntimeContext["state"]["config"]["runtime"]["notification"];
}) {
  const status = await runtimeStorage.status.load(params.mode);
  const notified = status.dailyPnlLimitNotified ?? {};

  if (!params.evaluation.reached) {
    const needsRearm = NOTIFICATION_CHANNELS.some(
      (channel) =>
        notified[channel]?.d === params.evaluation.day && notified[channel]?.b,
    );
    if (needsRearm) {
      await runtimeStorage.status.update(params.mode, (current) => {
        const state = { ...(current.dailyPnlLimitNotified ?? {}) };
        for (const channel of NOTIFICATION_CHANNELS) {
          if (state[channel]?.d === params.evaluation.day && state[channel]?.b) {
            state[channel] = { b: false, d: params.evaluation.day };
          }
        }
        current.dailyPnlLimitNotified = state;
      });
    }
    return;
  }

  for (const channel of NOTIFICATION_CHANNELS) {
    const alreadyNotified =
      notified[channel]?.d === params.evaluation.day && notified[channel]?.b;
    const enabled = getNotificationTypeConfig(
      params.notification,
      channel,
      "NOTIF_DAILY_PNL_LIMIT",
    );
    if (alreadyNotified || !enabled) continue;

    try {
      await systemNotif.central({
        channel,
        dashboard: "SLOW",
        dedupeKey: [
          "slow-daily-pnl-limit",
          channel,
          params.mode,
          params.evaluation.day,
          params.evaluation.pnlUsdt,
        ].join(":"),
        // PROD:NOTIF_DAILY_PNL_LIMIT
        key: "NOTIF_DAILY_PNL_LIMIT",
        message: [
          `UTC day: ${params.evaluation.day}`,
          `Mode: ${params.mode}`,
          `Navbar USD PnL: ${formatSignedUsdt(params.evaluation.pnlUsdt)}`,
          `Auto-entry stop: ${formatSignedUsdt(params.evaluation.thresholdUsdt)}`,
          "Automatic entry: PAUSED",
          "Automatic exits and manual entries remain available.",
          `Time: ${new Date(params.currentTimeMs).toISOString()}`,
        ].join("\n"),
        title: `[DAILY PNL] Auto-entry paused (${params.evaluation.day} UTC)`,
      });
      await runtimeStorage.status.update(params.mode, (current) => {
        current.dailyPnlLimitNotified = {
          ...(current.dailyPnlLimitNotified ?? {}),
          [channel]: { b: true, d: params.evaluation.day },
        };
      });
    } catch (error) {
      systemLog.error(
        `[slow-trading] failed to send ${channel} daily PnL entry-stop notification`,
        error,
      );
    }
  }
}

/**
 * Management stage: refreshes per-account balance snapshots, evaluates the
 * combined live+sandbox daily-PnL entry stop, and sends the completed UTC
 * day's performance report once per enabled channel.
 */
async function runManagement(
  context: RuntimeContext,
): Promise<RuntimeStageRunPatch> {
  const now = context.state.currentTime;
  const mode = modeOf(context);
  const enabledAccounts = context.state.config.accounts.filter(
    (account) => account.enabled,
  );

  // 1. Daily balance snapshots — one upsert per enabled account per day.
  for (const account of enabledAccounts) {
    const balance = context.state.balance[account.slug];
    if (!balance || !Number.isFinite(balance.total)) continue;
    await runtimeBalanceSnapshots.upsert({
      account: account.slug,
      mode,
      timestamp: now,
      total: balance.total,
    });
  }

  // 2. Daily-PnL entry stop over combined live+sandbox closed history.
  // BOTH:AUTO_ENTRY_DAILY_PNL_LIMIT_USDT
  const period = runtimeDailyPnlLimit.period.getCurrentUtc(now);
  const archived = (
    await Promise.all(
      (["live", "sandbox"] as const).map((historyMode) =>
        runtimeStorage.history.readRange({
          endTime: period.endTime,
          mode: historyMode,
          startTime: period.startTime,
        }),
      ),
    )
  ).flat();
  const pnlUsdt = runtimeDailyPnlLimit.pnl.sumForUtcDay(archived, period.day);
  const evaluation = runtimeDailyPnlLimit.guard.evaluatePnl({
    currentTimeMs: now,
    pnlUsdt,
    thresholdUsdt: context.state.config.runtime.autoEntryDailyPnlLimitUSDT,
  });

  await runtimeStorage.status.update(mode, (current) => {
    current.dailyPnlLimitState = { d: evaluation.day, usdt: evaluation.pnlUsdt };
  });
  await notifyDailyPnlLimit({
    currentTimeMs: now,
    evaluation,
    mode,
    notification: context.state.config.runtime.notification,
  });

  // 3. Completed-day performance report, once per enabled channel.
  const reportPeriod =
    runtimeDailyPerformance.report.getPreviousCompletedUtcDay(now);
  const notification = context.state.config.runtime.notification;
  const status = await runtimeStorage.status.load(mode);
  const pendingChannels = NOTIFICATION_CHANNELS.filter((channel) => {
    const enabled = getNotificationTypeConfig(
      notification,
      channel,
      "NOTIF_DAILY_PERFORMANCE",
    );
    return enabled && status.dailyPerformanceNotified?.[channel] !== reportPeriod.day;
  });

  if (pendingChannels.length > 0 && enabledAccounts.length > 0) {
    const accountSlugs = enabledAccounts.map((account) => account.slug);
    const accountSlugSet = new Set(accountSlugs);
    const [history, balanceSnapshots] = await Promise.all([
      runtimeStorage.history.readRange({
        endTime: reportPeriod.dayEndMs,
        mode,
        startTime: reportPeriod.dayStartMs,
      }),
      runtimeBalanceSnapshots.readCombined({
        accounts: accountSlugs,
        mode,
      }),
    ]);
    const startingBalances = enabledAccounts
      .map((account) => context.state.balance[account.slug]?.startingBalance)
      .filter((value): value is number =>
        typeof value === "number" && Number.isFinite(value),
      );
    const report = runtimeDailyPerformance.report.create({
      balanceSnapshots,
      currentTimeMs: now,
      history: history
        .filter((position) => accountSlugSet.has(position.account))
        .map((position) => ({
          entryTime: position.opened.t,
          exitTime: position.closed?.t,
          netPnlPct: position.pnl.netPct,
          netProfitUSDT: position.pnl.netUsdt,
        })),
      startingBalanceUSDT:
        startingBalances.length === enabledAccounts.length
          ? startingBalances.reduce((total, value) => total + value, 0)
          : undefined,
    });

    const { balance, day, trades } = report;
    const modePrefix = mode === "sandbox" ? "[SANDBOX]" : "";
    const title =
      `${modePrefix}[DAILY] ${formatDailyTitleDay(day)} UTC | ` +
      `${formatSignedUsdt(trades.pnlUsdt)} | ` +
      `+$${trades.winningPnlUsdt.toFixed(2)} ` +
      `-$${Math.abs(trades.losingPnlUsdt).toFixed(2)} | ` +
      `WR ${trades.winRate.toFixed(2)}% ` +
      `(${trades.wins}W / ${trades.losses}L)`;
    const message = [
      `UTC day: ${day}`,
      `Mode: ${mode}`,
      `Exchange: ${context.state.config.management.exchangeType}`,
      `Accounts: ${accountSlugs.join(", ")}`,
      `Trade PnL: ${formatSignedUsdt(trades.pnlUsdt)}`,
      `Trade PnL %: ${formatSignedPercent(trades.pnlPercent)}`,
      `Trades: ${trades.trades}`,
      `Wins: ${trades.wins}`,
      `Losses: ${trades.losses}`,
      `Win rate: ${trades.winRate.toFixed(2)}%`,
      `Balance PnL: ${balance.pnlUsdt === null ? "-" : formatSignedUsdt(balance.pnlUsdt)}`,
      `Balance PnL %: ${balance.pnlPercentOfStart === null ? "-" : formatSignedPercent(balance.pnlPercentOfStart)}`,
      `Start balance: ${formatBalanceUsdt(balance.startBalance)}`,
      `End balance: ${formatBalanceUsdt(balance.endBalance)}`,
    ].join("\n");

    for (const channel of pendingChannels) {
      await systemNotif.central({
        channel,
        dashboard: "SLOW",
        dedupeKey: [
          "slow-daily-performance",
          channel,
          mode,
          day,
        ].join(":"),
        // PROD:NOTIF_DAILY_PERFORMANCE
        key: "NOTIF_DAILY_PERFORMANCE",
        message,
        title,
      });
    }

    await runtimeStorage.status.update(mode, (current) => {
      const marked = { ...(current.dailyPerformanceNotified ?? {}) };
      for (const channel of pendingChannels) {
        marked[channel] = day;
      }
      current.dailyPerformanceNotified = marked;
    });
  }

  return {
    reports: 0,
    summary:
      `${mode} management pass | daily pnl ${formatSignedUsdt(evaluation.pnlUsdt)}` +
      `${evaluation.reached ? " (entry stop reached)" : ""}` +
      ` | snapshots ${enabledAccounts.length}`,
    symbols: enabledAccounts.length,
  };
}

/** Persists one stage's measured run stats under `status.stageRuns`. */
async function recordStageStats(
  stage: RuntimeStage,
  stats: RuntimeStageRunStats,
  context: RuntimeContext,
): Promise<void> {
  const mode = modeOf(context);
  await runtimeStorage.status.update(mode, (current) => {
    current.stageRuns = { ...(current.stageRuns ?? {}), [stage]: stats };
  });
}

/** Persists the whole scheduler tick as the mode's `lastRun*` summary. */
async function recordCycleComplete(
  stats: RuntimeStageRunStats,
  context: RuntimeContext,
): Promise<void> {
  const mode = modeOf(context);
  await runtimeStorage.status.update(mode, (current) => {
    current.lastRunAt = stats.t;
    current.lastRunDurationMs = stats.ms;
    current.lastRunPerformance = stats.performance;
    current.lastRunSummary = stats.summary;
  });
}

/** Grouped environment-owned stage implementations wired into the adapter. */
const productionStages = {
  cycleComplete: recordCycleComplete,
  management: runManagement,
  riskSentinel: runRiskSentinel,
  stageStats: recordStageStats,
} as const;

export default productionStages;
export { productionStages };
