import type { FeatureGateSession } from "@/lib/strategies/feature-gates";

import artifactFormat from "./artifact";
import neuralSession from "./session";

/** Loads saved weights once per engine/evaluation. The saved artifact survives in-memory disposal. */
async function load(file?: string): Promise<FeatureGateSession> {
  const [{ readFile }, { default: path }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const target = file ?? path.resolve("src/lib/strategies/default_with_features_gate/features/v3/model.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("v3 NN model is missing. Run npm run nn:train first.");
    throw error;
  }
  artifactFormat.validate(value);
  return neuralSession.create(value);
}

const featureGateV3 = { create: neuralSession.create, load } as const;
export default featureGateV3;
export type * from "./types";
