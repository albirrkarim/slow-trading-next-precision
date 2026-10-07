import { createHash } from "node:crypto";

import featureGate from "@/lib/dev/feature-gate";
import v3 from "@/lib/strategies/default_with_features_gate/features/v3";

/** Scores one frozen saved model, loading/warming once and disposing even if inference throws. */
async function run(hash: string, modelPath: string, log: (message: string) => void) {
  log(`FINAL TEST reading ${hash}; saved weights, preprocessing and cutoff remain frozen`);
  const bySymbol = await featureGate.dataset.readRows(hash);
  const fingerprint = createHash("sha256").update(JSON.stringify(bySymbol)).digest("hex");
  const rows = Object.values(bySymbol).flat();
  log(`FINAL TEST datasetSHA256=${fingerprint}`);
  const started = Date.now();
  const session = await v3.load(modelPath);
  log("FINAL TEST model loaded into memory and warmed; starting row loop");
  let metrics;
  try { metrics = featureGate.metrics.scoreRows(session.gate, rows); }
  finally { session.dispose(); log("FINAL TEST inference session disposed; saved weights retained"); }
  const worst = metrics.acceptedScoreDistribution.worstScore;
  // Captured unresolved acceptances cannot establish a successful outcome audit.
  const acceptedResolved = Object.entries(metrics.acceptedScoreDistribution)
    .filter(([key]) => /^\d+$/.test(key)).reduce((sum, [, count]) => sum + (count ?? 0), 0);
  const status = acceptedResolved > 0 && acceptedResolved === metrics.accepted && worst !== undefined && worst < 3 ? "passed" : "failed";
  log(`FINAL TEST ${status.toUpperCase()} accepted=${metrics.accepted}/${metrics.total} (${(metrics.acceptanceRate * 100).toFixed(2)}%) mean=${metrics.acceptedScoreDistribution.avgScore?.toFixed(3) ?? "n/a"} worst=${worst ?? "n/a"} elapsed=${Date.now() - started}ms`);
  log(`FINAL TEST exact distribution=${JSON.stringify(metrics.acceptedScoreDistribution)}`);
  if (acceptedResolved !== metrics.accepted) log("FINAL TEST unresolved accepted rows prevent a complete outcome audit");
  return { status, metrics, fingerprint };
}

const assessment = { run } as const;
export default assessment;
