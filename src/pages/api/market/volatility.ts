import type { ExchangeType } from "@/lib/exchange/types";
import { DEFAULT_EXCHANGE } from "@/lib/exchange/constants";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";
import production from "@/lib/production";
import {
  resolveVolatilityRetracePct,
  resolveVolatilityThreshold,
  windowsMs,
} from "@/lib/system/constants";
import { runtimeStorage, storageFiles } from "@/lib/system/storage";
import type { VolatilityPoint } from "@/lib/system/types";
import { reserve, runtimeEntrySequences } from "@/lib/system/trading";
import klineUtils from "@/lib/system/utils/klines";
import vpoints from "@/lib/system/utils/vpoints";
import { systemLog } from "@/lib/system/logging";
import fs from "fs-extra";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // 🧩 Set CORS headers (allow all origins)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // ⚡ Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    res.status(204).end(); // no content
    return;
  }

  if (req.method === "GET" || req.method === "POST") {
    await keepTheVolatilityUpdated(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

function pickExchangeParam(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const first = value.find(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
    return typeof first === "string" ? first.trim() : undefined;
  }

  return undefined;
}

function pickTimeParam(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Keeps only entry-signal markers visible in the selected dashboard window. */
export function filterDashboardEntrySignalResponse({
  endTimeMs,
  entrySignals,
  startTimeMs,
}: {
  endTimeMs?: number;
  entrySignals: VolatilityPoint[];
  startTimeMs?: number;
}) {
  if (startTimeMs === undefined && endTimeMs === undefined) {
    return entrySignals;
  }

  return entrySignals.filter(
    (point) =>
      (startTimeMs === undefined || point.t >= startTimeMs) &&
      (endTimeMs === undefined || point.t <= endTimeMs),
  );
}

async function keepTheVolatilityUpdated(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const params = req.method == "GET" ? req.query : req.body;
  const requestedExchangeType = pickExchangeParam(params.exchangeType);
  const catalog = await runtimeStorage.catalog.ensure();
  const exchangeType =
    requestedExchangeType ??
    catalog.config.management.exchangeType ??
    DEFAULT_EXCHANGE;
  const marketType = resolveMarketTypeForTradingMode(
    catalog.config.management.tradingMode,
  );
  const {
    verbose = false,
    logCategories,
    symbols = [],
    forceUpdate = false,
    removeUsed = false,
  } = params;

  const logSession = systemLog.startSession({
    categories: logCategories,
    verbose: Boolean(verbose),
  });

  const startTimeMs = pickTimeParam(params.startTime);
  const endTimeMs = pickTimeParam(params.endTime);

  try {
    // Clearing persisted markers alone is not enough: the running engine owns
    // separate in-memory vPointsMap objects whose surviving `usedBy`
    // markers would be merged back into the files on the next state-change
    // flush. Reset the live copies first, serialized with the engine's
    // scheduled stages, so later flushes persist the cleared state.
    if (removeUsed && symbols.length > 0) {
      try {
        await production.runtime.get().runManual(async (context) => {
          for (const rawSymbol of symbols) {
            const points =
              context.state.vPointsMap[String(rawSymbol).toUpperCase()];
            for (const point of points ?? []) {
              reserve.vpoints.resetUsage(point);
            }
          }
        });
      } catch (error) {
        systemLog.warn(
          "[volatility] failed to reset in-memory vPoint usage markers",
          error,
        );
      }
    }

    const volatilityMap: Record<string, VolatilityPoint[]> = {};

    systemLog.log("tradeLog categories", systemLog.categories);

    for (const symbol of symbols) {
      // A. Load existing volatility from storage if it exists
      if (
        (await fs.exists(
          `${storageFiles.prod.volatility(exchangeType)}/${symbol}.json`,
        )) &&
        !forceUpdate
      ) {
        systemLog.debug("Load volatility from json ", symbol);
        volatilityMap[symbol] = await runtimeStorage.vpoints.read({
          exchangeType: exchangeType as ExchangeType,
          symbol,
        });
      } else {
        // B. Otherwise, detect vPoints over a six-month 5m window and persist
        systemLog.debug("get new the volatility ", symbol);

        const detected = vpoints.detectVPoints({
          klines: await klineUtils.downloadRange({
            endTime: Date.now(),
            exchangeType: exchangeType as ExchangeType,
            interval: "5m",
            marketType,
            startTime: Date.now() - windowsMs["6m"],
            symbol: `${symbol}_USDT`,
            tradingMode: catalog.config.management.tradingMode,
          }),
          moveThreshold: resolveVolatilityThreshold(
            catalog.config.management,
          ),
          retracePercent: resolveVolatilityRetracePct(
            catalog.config.management,
          ),
          symbol,
        });

        await runtimeStorage.vpoints.merge({
          exchangeType: exchangeType as ExchangeType,
          symbol,
          points: detected,
        });

        volatilityMap[symbol] = await runtimeStorage.vpoints.read({
          exchangeType: exchangeType as ExchangeType,
          symbol,
        });
      }

      // C. Optionally remove used volatility points
      if (removeUsed) {
        systemLog.debug("Remove used vpoint ", symbol);

        for (const item of volatilityMap[symbol]) {
          // BOTH:MULTI_ACCOUNT_ENTRY_VPOINT_USAGE
          reserve.vpoints.resetUsage(item);
        }

        // mergeById cannot clear usage keys — absent fields survive the
        // spread — so the strip runs atomically on the file's own contents.
        await runtimeStorage.vpoints.resetUsage({
          exchangeType: exchangeType as ExchangeType,
          symbol,
        });
      }
    }

    const responseVolatilityMap = runtimeEntrySequences.range.crop({
      endTimeMs,
      startTimeMs,
      volatilityMap,
    });

    const output = {
      status: true,
      data: responseVolatilityMap,
      series: [],
    };

    res.json(output);
  } catch (err) {
    systemLog.error(err);
    res.status(500).json({
      status: false,
      data: {},
      series: [],
    });
  } finally {
    systemLog.endSession(logSession);
  }
}
