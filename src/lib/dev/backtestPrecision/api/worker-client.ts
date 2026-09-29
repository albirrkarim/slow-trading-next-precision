import { fork } from "child_process";
import path from "path";
import type { BacktestChunkedResult } from "../backtest/backtest-precision-types";
import type { BacktestWorkerRequest, BacktestWorkerResponse } from "./worker";

// Built from segments so the fork target stays a runtime-resolved fs path —
// a statically analyzable literal gets bundled as a module and breaks.
const WORKER_SEGMENTS = [
  "src",
  "lib",
  "dev",
  "backtestPrecision",
  "api",
  "worker.ts",
] as const;

/** Runs a long backtest outside the Next dev server's monitored heap. */
function run(params: BacktestWorkerRequest): Promise<BacktestChunkedResult> {
  return new Promise((resolve, reject) => {
    const worker = fork(
      [process.cwd(), ...WORKER_SEGMENTS].join(path.sep),
      [],
      {
        execArgv: ["--import", "tsx", "--require", "tsconfig-paths/register"],
        serialization: "json",
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    worker.on("message", (message: BacktestWorkerResponse) => {
      if (settled) return;
      settled = true;
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.on("error", fail);
    worker.on("exit", (code, signal) => {
      fail(
        new Error(
          `Backtest worker exited before returning a result (code ${code}, signal ${signal}).`,
        ),
      );
    });
    worker.send(params, (error) => {
      if (error) fail(error);
    });
  });
}

const backtestWorker = { run } as const;

export default backtestWorker;
