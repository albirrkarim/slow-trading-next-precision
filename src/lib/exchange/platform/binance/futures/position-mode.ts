import { requestPrivate } from "../utils";

const FUTURES_BASE_URL = "https://fapi.binance.com";

export type BinanceFuturesPositionMode = "ONE_WAY" | "HEDGE";

interface BinancePositionModeResponse {
  dualSidePosition: boolean;
}

interface BinanceChangePositionModeResponse {
  code: number;
  msg: string;
}

/** Gets the current USD-M futures account position mode. */
async function get(): Promise<BinanceFuturesPositionMode> {
  const response = await requestPrivate<BinancePositionModeResponse>(
    "/fapi/v1/positionSide/dual",
    {},
    "get",
    FUTURES_BASE_URL,
  );

  return response.dualSidePosition ? "HEDGE" : "ONE_WAY";
}

/** Changes the USDⓈ-M futures account position mode for every symbol. */
async function change(
  mode: BinanceFuturesPositionMode,
): Promise<BinanceFuturesPositionMode> {
  const response = await requestPrivate<BinanceChangePositionModeResponse>(
    "/fapi/v1/positionSide/dual",
    { dualSidePosition: mode === "HEDGE" },
    "post",
    FUTURES_BASE_URL,
  );

  if (response.code !== 200) {
    throw new Error(
      `Binance failed to change futures position mode: ${response.msg || response.code}`,
    );
  }

  return mode;
}

const binanceFuturesPositionMode = {
  change,
  get,
} as const;

export default binanceFuturesPositionMode;
