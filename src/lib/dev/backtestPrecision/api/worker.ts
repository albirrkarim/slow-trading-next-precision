import { precisionBacktest } from "../backtest";
import type { BacktestChunkedResult } from "../backtest/backtest-precision-types";
import type { BacktestPrecisionParams } from "./precision-api-types";

export interface BacktestWorkerRequest extends BacktestPrecisionParams {
  artifacts: { dir: string };
}

export type BacktestWorkerResponse =
  | { ok: true; result: BacktestChunkedResult }
  | { ok: false; error: string };

process.once("message", async (params: BacktestWorkerRequest) => {
  let response: BacktestWorkerResponse;
  try {
    const result = await precisionBacktest(params);
    response = { ok: true, result };
  } catch (error) {
    process.exitCode = 1;
    response = {
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }
  process.send?.(response, () => process.disconnect?.());
});
