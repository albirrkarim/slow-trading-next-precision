import { RuntimeEngine } from "@/lib/precision";
import type { Kline } from "@/lib/exchange/types";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import { buildKlinesMap, getDatasetKlines, getEarliestOpenTime } from "./data";

export async function precisionBacktest(
  params: BacktestPrecisionParams,
): Promise<void> {
  // A. Prepare klines
  // BTEST:BACKTEST_DATASET
  const [klinesMap1m, klinesMap5m] = await Promise.all([
    buildKlinesMap(params, "1m"),
    buildKlinesMap(params, "5m"),
  ]);

  // B. Prepare state and adapter
  const state: RuntimeEngineState = {
    balance: {},
    config: params.config,
    currentTime: params.startTime ?? getEarliestOpenTime(klinesMap1m),
    mode: "backtest",
    openPositions: [],
  };

  const maps = {
    "1m": klinesMap1m,
    "5m": klinesMap5m,
  };

  const adapter: RuntimeEngineAdapter = {
    market: {
      getKlines: (props) => getDatasetKlines(props, maps),
    },
    exchange: {
      getBalance() {
        return 0;
      },
    },
    onStrategy: () => true,
    onAction: () => true,
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
}
