import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import featureGate from "@/lib/dev/feature-gate";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";

/** Reads the current cache or a checksum-verified snapshot belonging to the requested cache key. */
async function read(hash: string, directory?: string): Promise<Record<string, FeatureGateDatasetRow[]>> {
  if (!directory) return featureGate.dataset.readRows(hash);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
    cacheKey?: string; files?: Record<string, string>;
  };
  if (manifest.cacheKey !== hash || !manifest.files || !Object.keys(manifest.files).length) {
    throw new Error("Test snapshot manifest does not match the requested dataset hash.");
  }
  const result: Record<string, FeatureGateDatasetRow[]> = {};
  for (const [name, expected] of Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[A-Z0-9_]+\.json$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid test snapshot manifest entry.");
    const content = await readFile(path.join(directory, name));
    if (createHash("sha256").update(content).digest("hex") !== expected) throw new Error(`Test snapshot checksum mismatch: ${name}`);
    const rows: unknown = JSON.parse(content.toString("utf8"));
    if (!Array.isArray(rows)) throw new Error(`Test snapshot rows must be an array: ${name}`);
    result[name.slice(0, -5)] = rows as FeatureGateDatasetRow[];
  }
  return result;
}

const assessmentInput = { read } as const;
export default assessmentInput;
