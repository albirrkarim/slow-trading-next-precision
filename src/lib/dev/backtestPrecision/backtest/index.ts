import { RuntimeEngine } from "@/lib/precision";
import {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import { BacktestPrecisionParams } from "../api/precision-api-types";
import { Kline } from "@/lib/exchange/types";

export function precisionBacktest(params: BacktestPrecisionParams) {
  // B. Getting klines to provide the runtime with klines data
  // preparing the klines first save to storage

  // params.config.management.symbols
  // params.range

  const klinesMap1m:Record<string,Kline[]> = 

  const klinesMap5m:Record<string,Kline[]> = 





  // C. runing the backtest 
  const state: RuntimeEngineState = {};

  const klinesMap = {};

  const adapter: RuntimeEngineAdapter = {
    market: {
      getKlines: fetchKlinesFunction,
    },
    exchange: {
      getBalance() {
        return 0;
      },
    },
    onStrategy: () => {
      return true;
    },
    onAction: () => {
      return true;
    },
    onNotif: () => {
      return true;
    },
  };

  const backtestRuntimeEngine = new RuntimeEngine(state, adapter);
}
