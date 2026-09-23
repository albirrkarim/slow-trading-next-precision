import { DEFAULT_EXCHANGE } from "@/lib/exchange/constants";
import exchangeFundingRate from "@/lib/exchange/funding-rate";
import {
  getMarketCapFetchedAtMapForSymbols,
  getMarketCapUSDMapForSymbols,
} from "@/lib/exchange/market-cap";
import type { ExchangeType } from "@/lib/exchange/types";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";
import { windowsMs } from "@/lib/system/constants";
import { systemLog } from "@/lib/system/logging";
import { runtimeStorage, storageFiles } from "@/lib/system/storage";
import type { VolatilityPoint } from "@/lib/system/types";
import { runtimeMarketVolume } from "@/lib/system/dashboard";
import klineUtils from "@/lib/system/utils/klines";
import vpoints from "@/lib/system/utils/vpoints";
import fs from "fs-extra";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET" || req.method === "POST") {
    await initializeDashboard(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
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

async function initializeDashboard(req: NextApiRequest, res: NextApiResponse) {
  const params = req.method == "GET" ? req.query : req.body;
  const requestedExchangeType = pickExchangeParam(params.exchangeType);
  const catalog = await runtimeStorage.catalog.ensure();
  const exchangeType =
    requestedExchangeType ??
    catalog.config.management.exchangeType ??
    DEFAULT_EXCHANGE;
  const tradingMode = catalog.config.management.tradingMode;
  const marketType = resolveMarketTypeForTradingMode(tradingMode);

  // Destructure from body
  const {
    reinitialize = false,
    symbols = ["ETH", "HBAR"],
    verbose = false,
    logCategories,
  } = params;

  const logSession = systemLog.startSession({
    categories: logCategories,
    verbose: Boolean(verbose),
  });

  try {
    systemLog.log("exchangeType", exchangeType);
    systemLog.log("tradingMode", tradingMode);
    systemLog.log("marketType", marketType);

    if (reinitialize) {
      await fs.remove(storageFiles.prod.volatility(exchangeType));
    }

    await fs.ensureDir(storageFiles.prod.volatility(exchangeType));

    let volumeSnapshot = await runtimeMarketVolume.snapshot.read(
      exchangeType as ExchangeType,
      marketType,
    );
    try {
      volumeSnapshot = await runtimeMarketVolume.snapshot.refresh({
        exchangeType: exchangeType as ExchangeType,
        marketType,
        symbols,
      });
    } catch (error) {
      systemLog.error("Failed to refresh 24h ticker volume", error);
    }

    const marketCapUSDBySymbol = await getMarketCapUSDMapForSymbols(symbols);
    const marketCapFetchedAtBySymbol =
      await getMarketCapFetchedAtMapForSymbols(symbols);
    let fundingRateBySymbol = {};
    try {
      fundingRateBySymbol = await exchangeFundingRate.latest.map({
        exchangeType: exchangeType as ExchangeType,
        tradingMode,
        symbols,
      });
    } catch (error) {
      systemLog.error("Failed to refresh dashboard funding rates", error);
    }

    if (
      !(await fs.exists(
        `${storageFiles.prod.volatility(exchangeType)}/${symbols[0]}.json`,
      )) ||
      reinitialize
    ) {
      // Volatility
      const volatilityMap: Record<string, VolatilityPoint[]> = {};
      // check directory
      const files = await fs.readdir(storageFiles.prod.volatility(exchangeType));

      systemLog.log("files ", files);

      for (const symbol of symbols) {
        // A. Load existing volatility from storage if it exists
        if (
          (await fs.exists(
            `${storageFiles.prod.volatility(exchangeType)}/${symbol}.json`,
          )) &&
          !reinitialize
        ) {
          systemLog.debug(
            "A. Load existing volatility from file if exists ",
            symbol,
          );
          volatilityMap[symbol] = await runtimeStorage.vpoints.read({
            exchangeType: exchangeType as ExchangeType,
            symbol,
          });
        } else {
          // B. Otherwise, detect vPoints over a six-month 5m window and persist
          systemLog.debug("B. Otherwise, generate new volatility data ", symbol);

          const detected = vpoints.detectVPoints({
            klines: await klineUtils.downloadRange({
              endTime: Date.now(),
              exchangeType: exchangeType as ExchangeType,
              interval: "5m",
              marketType,
              startTime: Date.now() - windowsMs["6m"],
              symbol: `${symbol}_USDT`,
              tradingMode,
            }),
            symbol,
          });

          await runtimeStorage.vpoints.merge({
            exchangeType: exchangeType as ExchangeType,
            symbol,
            points: detected,
          });

          volatilityMap[symbol] = detected;
        }
      }
    }

    res.json({
      message: "Dashboard initialized successfully",
      data: {
        exchangeType,
        fundingRateBySymbol,
        marketType,
        marketCapFetchedAtBySymbol,
        marketCapUSDBySymbol,
        tradingMode,
        volume24hBySymbol: volumeSnapshot?.volumes ?? {},
        volume24hUpdatedAt: volumeSnapshot?.t ?? null,
      },
    });
  } finally {
    systemLog.endSession(logSession);
  }
}
