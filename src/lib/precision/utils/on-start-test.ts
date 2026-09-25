import systemLog from "@/lib/system/logging";
import entry from "@/lib/system/trading/entry";

import {
  LIVE_FEED_PROBE_POLL_MS,
  LIVE_FEED_PROBE_TIMEOUT_MS,
  MARK_PRICE_LOOKBACK_MINUTES,
} from "../constant";
import type { RuntimeEngineAdapter, RuntimeEngineState } from "../types";
import runtimeErrors from "./errors";

type CheckStatus = "failed" | "partial" | "pending" | "skipped" | "success";

interface CheckItem {
  detail?: string;
  label: string;
  status: CheckStatus;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probes each of the adapter's market-data functions and prints a numbered
 * checklist. Failures go to the error log plus the configured NOTIF_ERROR
 * channels so a broken market path is loud at boot instead of surfacing as
 * repeated stage failures. Never throws — a failing probe still lets the
 * engine start and retry through the normal fallback.
 */
async function marketData(params: {
  adapter: RuntimeEngineAdapter;
  state: RuntimeEngineState;
}): Promise<void> {
  const { adapter, state } = params;

  try {
    const marketType =
      state.config.management.tradingMode === "futures" ? "FUTURES" : "SPOT";
    const symbols = entry.getSymbols(state.config, state.openPositions);
    const items: CheckItem[] = [];

    // REST klines — the always-required path: backtest source, cold-start
    // warm-up, and live-feed fallback.
    const klineFailures: string[] = [];
    for (const symbol of symbols) {
      try {
        const klines = await adapter.market.getKlines({
          endTime: state.currentTime,
          interval: "5m",
          marketType,
          minutes: MARK_PRICE_LOOKBACK_MINUTES,
          symbol: `${symbol}_USDT`,
        });
        if (!Number.isFinite(Number(klines.at(-1)?.[4]))) {
          klineFailures.push(`${symbol}: no usable closed kline`);
        }
      } catch (error) {
        klineFailures.push(
          `${symbol}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    items.push({
      detail:
        klineFailures.length === 0
          ? `${symbols.length} symbol(s)`
          : klineFailures.join("; "),
      label: "adapter.market.getKlines",
      status: klineFailures.length === 0 ? "success" : "failed",
    });

    // Live websocket feed — only present when the environment wired one
    // (production). The socket needs seconds to connect and deliver first
    // events, so markPrice is polled within a bounded window.
    const live = adapter.market.live;
    if (!live) {
      items.push(
        {
          detail: "not wired on this adapter",
          label: "adapter.market.live.markPrice",
          status: "skipped",
        },
        {
          detail: "not wired on this adapter",
          label: "adapter.market.live.closedKlines",
          status: "skipped",
        },
      );
    } else if (symbols.length === 0) {
      items.push(
        {
          detail: "no symbols to track",
          label: "adapter.market.live.markPrice",
          status: "skipped",
        },
        {
          detail: "no symbols to track",
          label: "adapter.market.live.closedKlines",
          status: "skipped",
        },
      );
    } else {
      live.track(symbols, "5m");
      const pollStartedAt = Date.now();
      const deadline = pollStartedAt + LIVE_FEED_PROBE_TIMEOUT_MS;
      let unserved = symbols;
      while (Date.now() < deadline) {
        unserved = symbols.filter(
          (symbol) => live.markPrice(symbol, "5m") === undefined,
        );
        if (unserved.length === 0) break;
        await sleep(LIVE_FEED_PROBE_POLL_MS);
      }
      const markServed = symbols.length - unserved.length;
      // Any served symbol proves the stream delivers — an unserved subset
      // is a coverage gap (e.g. not listed on this market) that REST
      // absorbs per symbol, not a dead feed.
      const streamAlive = markServed > 0;
      items.push({
        detail:
          unserved.length === 0
            ? `${markServed}/${symbols.length} in ` +
              `${((Date.now() - pollStartedAt) / 1000).toFixed(1)}s`
            : `served ${markServed}/${symbols.length} within ` +
              `${LIVE_FEED_PROBE_TIMEOUT_MS / 1000}s` +
              (streamAlive ? ` — unserved: ${unserved.join(", ")}` : ""),
        label: "adapter.market.live.markPrice",
        status:
          unserved.length === 0
            ? "success"
            : streamAlive
              ? "partial"
              : "failed",
      });

      // closedKlines is anchored to the 5m boundary at probe start, so a
      // mid-candle boot asks for a candle that has not closed yet: the feed
      // answers `undefined` or `[]` — still warming, not a failure. Only a
      // non-empty array of closed candles proves the buffer serves the
      // runtime window; an empty one must never count as success.
      const klineWindowStart =
        Math.floor(pollStartedAt / (5 * 60_000)) * (5 * 60_000);
      const unwarmed = symbols.filter((symbol) => {
        const klines = live.closedKlines(symbol, "5m", klineWindowStart);
        return !klines || klines.length === 0;
      });
      items.push({
        detail:
          unwarmed.length === 0
            ? `${symbols.length} symbol(s)`
            : streamAlive
              ? `${unwarmed.length} symbol(s) awaiting first closed candle`
              : "stream stale or dead",
        label: "adapter.market.live.closedKlines",
        status:
          unwarmed.length === 0
            ? "success"
            : streamAlive
              ? "pending"
              : "failed",
      });
    }

    const report = [
      "",
      "===== On Start Testing ======",
      "",
      ...items.map(
        (item, index) =>
          `${index + 1}. ${item.label} [${item.status}]` +
          (item.detail ? ` — ${item.detail}` : ""),
      ),
      "",
      "=============================",
    ].join("\n");

    const failed = items.filter((item) => item.status === "failed");
    if (failed.length === 0) {
      systemLog.info(report);
      return;
    }

    systemLog.error(report);
    await runtimeErrors
      .record(
        "runtime.startup.market-data",
        new Error(
          `Startup market-data check failed:\n` +
            failed
              .map((item) => `- ${item.label}: ${item.detail ?? "failed"}`)
              .join("\n"),
        ),
      )
      .catch(() => undefined);
  } catch (error) {
    await runtimeErrors
      .record("runtime.startup.market-data", error)
      .catch(() => undefined);
  }
}

const runtimeSelfTest = { marketData } as const;

export default runtimeSelfTest;
export { runtimeSelfTest };
