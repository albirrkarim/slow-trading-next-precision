import { FILES } from "@/components/storage";
import fs from "fs-extra";
import precisionCapture from "./capture";
import precisionCompare from "./compare";
import type { PrecisionBacktestResultSummary } from "./types";

/** Lists persisted backtest results newest-first. */
async function listBacktestResults(): Promise<
  PrecisionBacktestResultSummary[]
> {
  const root = FILES.slow.precision.backtestResultRoot;
  await fs.ensureDir(root);
  const entries = await fs.readdir(root);
  const summaries: PrecisionBacktestResultSummary[] = [];

  for (const fileName of entries) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const run = await precisionCompare.run.read(`${root}/${fileName}`);
    summaries.push({
      fileName,
      strategy: run.strategy,
      startTime: run.startTime,
      endTime: run.endTime,
      positionCount: run.endPositions.length,
    });
  }

  return summaries.sort((left, right) => right.startTime - left.startTime);
}

/**
 * Grouped precision API for production capture, run comparison, and
 * backtest-result discovery.
 */
const precision = {
  backtest: {
    list: listBacktestResults,
  },
  capture: precisionCapture,
  compare: precisionCompare,
} as const;

export default precision;
export { precision };
export type {
  PrecisionCaptureEndResult,
  PrecisionCaptureStatus,
  PrecisionTestCaseSummary,
} from "./capture";
export type {
  PrecisionComparisonResult,
  PrecisionLeafDifference,
  PrecisionPairResult,
  PrecisionPositionSummary,
} from "./compare";
export type * from "./types";
