import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import jsonFile from "@/lib/system/storage/json-file";

import assessment from "./assessment";
import torch from "./torch";

type Params = Parameters<typeof torch.run>[0];
const families = [{ hidden: [16, 8], l2: 0.01 }, { hidden: [32, 16], l2: 0.001 },
  { hidden: [32, 16], l2: 0.01 }, { hidden: [32, 16], l2: 0.05 }];

/** Uses the lower training acceptance rate to avoid selecting large cross-coin coverage with an almost-empty full model. */
function coverage(heldAccepted: number, trainAccepted: number, usable: number): number {
  if (!Number.isInteger(usable) || usable < 1 || !Number.isFinite(heldAccepted) || !Number.isFinite(trainAccepted) ||
      heldAccepted < 0 || trainAccepted < 0 || heldAccepted > usable || trainAccepted > usable) throw new Error("Invalid research coverage counts.");
  return Math.min(heldAccepted, trainAccepted) / usable;
}

/** Compares eight Torch families using training coins only, then assesses/publishes the frozen winner once. */
async function run(params: Params) {
  if (params.trainHash === params.testHash) throw new Error("Train and test hashes must differ.");
  const results: Array<Record<string, unknown>> = [];
  let fingerprint: string | undefined;
  let best: { id: string; file: string; score: number; report: Awaited<ReturnType<typeof torch.run>> } | undefined;
  params.log("TORCH RESEARCH eight architecture/regularization/learning-target families; no test reads until selection ends");
  for (const family of families) for (const target of [1, 2] as const) {
    params.signal?.throwIfAborted();
    const id = `${params.torch.activation}-${family.hidden.join("x")}-decay${family.l2}-target${target}`;
    const dir = path.join(params.runDir, id);
    params.log(`EXPERIMENT ${results.length + 1}/8 ${id}`);
    try {
      const report = await torch.run({ ...params, testHash: undefined, snapshotDir: undefined, runDir: dir,
        modelPath: path.join(dir, "selected.json"), options: { ...params.options, ...family },
        torch: { ...params.torch, learningTarget: target }, log: (line) => params.log(`${id} ${line}`) });
      if (fingerprint !== undefined && report.fingerprint !== fingerprint) throw new Error("Training dataset changed during research; no test assessment or publication.");
      fingerprint = report.fingerprint;
      const score = coverage(report.selection.heldAccepted, report.trainMetrics.accepted, report.selection.heldTotal);
      results.push({ id, qualified: true, score, selection: report.selection, trainMetrics: report.trainMetrics, validation: report.validation });
      if (!best || score > best.score || (score === best.score && report.selection.heldAccepted > best.report.selection.heldAccepted)) {
        best = { id, file: path.join(dir, "model.json"), score, report };
        params.log(`BEST ${id} conservative training coverage=${(score * 100).toFixed(2)}%; test remains unread`);
      }
    } catch (error) {
      params.signal?.throwIfAborted();
      if (!(error instanceof Error) || ![
        "Training calibration left a coin with no acceptance; no model published.",
        "Torch runtime training audit failed; no model published.",
      ].includes(error.message)) throw error;
      results.push({ id, qualified: false, reason: error.message });
      params.log(`REJECT ${id}: ${error.message}`);
    }
    await jsonFile.write.atomic(path.join(params.runDir, "experiments.json"), { trainHash: params.trainHash, fingerprint, results, selected: best?.id });
  }
  if (!best) throw new Error("No Torch research candidate qualified; test not read and active model not replaced.");
  const content = await readFile(best.file);
  const modelHash = createHash("sha256").update(content).digest("hex");
  const frozenPath = path.join(params.runDir, "model.json");
  await jsonFile.write.atomic(frozenPath, JSON.parse(content.toString("utf8")));
  params.log(`FROZEN ${best.id} modelSHA256=${modelHash}; candidate=${frozenPath}`);
  params.signal?.throwIfAborted();
  const test = params.testHash ? await assessment.run(params.testHash, frozenPath, params.log, 300, params.snapshotDir) : undefined;
  const status = test?.status ?? "not-tested";
  if (status !== "failed") {
    await jsonFile.write.atomic(params.modelPath, JSON.parse(content.toString("utf8")));
    params.log(`EXPORT ${params.modelPath}`);
  } else params.log("FINAL TEST failed; research candidates retained; active model not replaced");
  const report = { status, modelHash, trainHash: params.trainHash, fingerprint, selection: best.id, coverage: best.score,
    options: { ...params.options, ...params.torch }, trainMetrics: best.report.trainMetrics, validation: best.report.validation,
    testHash: params.testHash, testMetrics: test?.metrics, testFingerprint: test?.fingerprint, testMinAccepted: test?.minAccepted, results };
  await jsonFile.write.atomic(path.join(params.runDir, "report.json"), report);
  params.log(`REPORT ${path.join(params.runDir, "report.json")}; outcome=${status}`);
  return report;
}

const torchResearch = { coverage, run } as const;
export default torchResearch;
