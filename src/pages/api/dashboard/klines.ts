import { KLINES_FOLDER, makeScopedFolder } from "@/components/api/constants";
import type { MultiLinePair } from "@/components/api/dynamic";
import {
  convertVolatilityToLeveledMarkers,
  convertVolatilityToMarkers,
  type Marker,
} from "@/components/LiveDashboard/converter";
import { buildTradeMarkersFromHistory } from "@/components/LiveDashboard/Shared/trade-chart-markers";
import { FILES } from "@/components/storage";
import { fetchKlinesFunction } from "@/lib/datasets/fetchKlines";
import { detectVolatilityPoints, type VolatilityPoint } from "@/lib/dynamic";
import type { ExchangeType } from "@/lib/exchange";
import { DEFAULT_EXCHANGE } from "@/lib/exchange/constants";
import { type Kline } from "@/lib/exchange/platform/tokocrypto";
import slowTrading from "@/lib/slowTrading";
import moment from "moment-timezone";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST" || req.method === "GET") {
    await getKlines(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

export interface getKlinesReturn {
  startKlines: string;
  endKlines: string;
  klines: Kline[];
  markers: Marker[];
  vPointsSeries: MultiLinePair;
}

type DashboardVolatilitySource = "generated" | "storage";

function pickStringParam(value: unknown): string | undefined {
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

function pickVolatilitySource(value: unknown): DashboardVolatilitySource {
  return pickStringParam(value) === "storage" ? "storage" : "generated";
}

function pickBooleanParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }

  return false;
}

function pickMarketType(value: unknown): "SPOT" | "FUTURES" | undefined {
  const marketType = pickStringParam(value)?.toUpperCase();
  return marketType === "SPOT" || marketType === "FUTURES"
    ? marketType
    : undefined;
}

/**
 * Keeps persisted volatility points aligned with the visible kline window.
 */
export function filterVolatilityPointsForKlines(
  points: VolatilityPoint[],
  klines: Kline[],
): VolatilityPoint[] {
  const firstTime = Number(klines[0]?.[0]);
  const lastTime = Number(klines.at(-1)?.[0]);

  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) {
    return points;
  }

  return points.filter((point) => point.t >= firstTime && point.t <= lastTime);
}

/**
 * Reads dashboard volatility points from the SLOW persistent storage source.
 */
export async function getStoredDashboardVolatilityPoints({
  exchange,
  klines,
  symbol,
}: {
  exchange: ExchangeType;
  klines: Kline[];
  symbol: string;
}): Promise<VolatilityPoint[]> {
  // PROD:SAME_VOLATILITY_POINT
  const storedPoints = await FILES.prod.volatilityPoints.get(exchange, symbol);
  return filterVolatilityPointsForKlines(storedPoints, klines);
}

export async function getKlines(req: NextApiRequest, res: NextApiResponse) {
  const params = req.method == "GET" ? req.query : req.body;

  // Destructure from body
  const {
    symbol = "BTC",
    range = "1year",
    interval = "5m",
    upToDateKlines = false,
    volatility = false,
    volatilitySource,
    tradeHistory,
    startTime,
    endTime,
  } = params;

  const symbolParam = pickStringParam(symbol) ?? "BTC";
  const exchange = (pickStringParam(params.exchange) ??
    pickStringParam(params.exchangeType) ??
    DEFAULT_EXCHANGE) as ExchangeType;
  const marketType = pickMarketType(params.marketType);
  const selectedVolatilitySource = pickVolatilitySource(volatilitySource);
  const parsedStartTime =
    typeof startTime === "string" ? Number(startTime) : Number(startTime ?? 0);
  const parsedEndTime =
    typeof endTime === "string" ? Number(endTime) : Number(endTime ?? 0);
  const hasTimeWindow =
    Number.isFinite(parsedStartTime) &&
    Number.isFinite(parsedEndTime) &&
    parsedStartTime > 0 &&
    parsedEndTime > parsedStartTime;
  const rangeForFetch = hasTimeWindow
    ? `${moment.utc(parsedStartTime).format("DD_MMM_YYYY_HH_mm")}_to_${moment
        .utc(parsedEndTime)
        .format("DD_MMM_YYYY_HH_mm")}`
    : range;

  const TRADE_PAIR = `${symbolParam}_USDT`;

  let klines = await fetchKlinesFunction({
    symbol: TRADE_PAIR,
    interval,
    simpleTime: rangeForFetch,
    ...(hasTimeWindow
      ? {
          startTime: parsedStartTime,
          endTime: parsedEndTime,
        }
      : {}),
    folder: makeScopedFolder({
      range: rangeForFetch,
      interval,
      baseFolder:
        KLINES_FOLDER + "/" + exchange + (marketType ? `/${marketType}` : ""),
    }),
    saveToFile: false,
    exactDate: hasTimeWindow,
    useCache: !upToDateKlines,
    verbose: true,
    exchangeType: exchange,
    marketType,
  });

  if (hasTimeWindow) {
    klines = klines.filter(
      (item) => item[0] >= parsedStartTime && item[0] <= parsedEndTime,
    );
  }

  const data: getKlinesReturn = {
    startKlines: moment.utc(klines[0]?.[0]).format("YYYY-MM-DD HH:mm:ss"),
    endKlines: moment
      .utc(klines[klines.length - 1]?.[0])
      .format("YYYY-MM-DD HH:mm:ss"),
    klines,
    markers: [],
    vPointsSeries: {
      series: [],
      names: [],
    },
  };

  // Volatility markers
  if (volatility) {
    const markers: Marker[] = [];

    const volatilityPoints =
      selectedVolatilitySource === "storage"
        ? await getStoredDashboardVolatilityPoints({
            exchange,
            klines,
            symbol: symbolParam,
          })
        : detectVolatilityPoints({ klines, symbol: symbolParam });

    const vMarkers = convertVolatilityToMarkers(volatilityPoints);
    markers.push(...vMarkers);

    data.markers = markers;

    const vPointsSeries: MultiLinePair = {
      series: [],
      names: [],
    };

    // simple chart
    const volatilityPointsLeveledMarkers = convertVolatilityToLeveledMarkers(
      symbolParam,
      volatilityPoints,
    );

    vPointsSeries.series.push(volatilityPointsLeveledMarkers);
    vPointsSeries.names.push(symbolParam);

    data.vPointsSeries = vPointsSeries;
  }

  if (pickBooleanParam(tradeHistory)) {
    const slowStorage = await slowTrading.storage.data.load({
      includeHistory: true,
    });
    const activeMode = slowTrading.storage.mode.getActive(slowStorage);
    const tradeRows = [
      ...slowTrading.storage.history.getClosed(slowStorage, activeMode),
      ...slowTrading.storage.history.getOpen(slowStorage, activeMode),
    ];
    const firstKlineTime = Number(klines[0]?.[0]) / 1000;
    const lastKlineTime = Number(klines.at(-1)?.[0]) / 1000;
    const tradeMarkers = buildTradeMarkersFromHistory(tradeRows, symbolParam);
    const visibleTradeMarkers =
      Number.isFinite(firstKlineTime) && Number.isFinite(lastKlineTime)
        ? tradeMarkers.filter(
            (marker) =>
              Number(marker.time) >= firstKlineTime &&
              Number(marker.time) <= lastKlineTime,
          )
        : tradeMarkers;

    data.markers.push(...visibleTradeMarkers);
  }

  res.json(data);
}
