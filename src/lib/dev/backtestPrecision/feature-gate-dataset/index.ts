import path from "path";

import jsonFile from "@/lib/system/storage/json-file";

import collector from "./collector";
import type { FeatureGateDatasetRow } from "./types";

/** `dataset/` subdirectory inside a run's artifact directory. */
function datasetDir(runDir: string): string {
  return path.join(runDir, "dataset");
}

/**
 * Writes the collected rows as `<runDir>/dataset/<SYMBOL>.json` — one
 * compact JSON array per symbol, chronological by formation point.
 */
async function write(
  runDir: string,
  rows: FeatureGateDatasetRow[],
): Promise<void> {
  const bySymbol = new Map<string, FeatureGateDatasetRow[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol);
    if (list) {
      list.push(row);
    } else {
      bySymbol.set(row.symbol, [row]);
    }
  }
  for (const [symbol, list] of bySymbol) {
    await jsonFile.write.atomic(
      path.join(datasetDir(runDir), `${symbol}.json`),
      list,
    );
  }
}

const featureGateDataset = {
  collector,
  datasetDir,
  write,
} as const;

export default featureGateDataset;
export type * from "./types";
