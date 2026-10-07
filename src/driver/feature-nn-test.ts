import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import nn from "@/lib/dev/nn";
import { DEFAULT_MODEL_PATH, DEFAULT_TEST_HASH } from "@/lib/dev/nn/run";
import jsonFile from "@/lib/system/storage/json-file";

/** Evaluates an existing frozen artifact without training or overwriting weights. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: "boolean" }, "test-hash": { type: "string" }, model: { type: "string" }, "run-dir": { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: npm run nn:test -- [options]
--test-hash HASH  Dataset to evaluate (default ${DEFAULT_TEST_HASH})
--model PATH     Existing frozen artifact (default ${DEFAULT_MODEL_PATH})
--run-dir PATH   Evaluation log/report directory (default unique storage/research/nn directory)
Exit codes: 0 = nonempty, fully resolved acceptance with worst score below 3; 1 = execution error; 2 = criterion failed.
No training, cutoff selection, or model writes occur.`);
    return;
  }
  const modelPath = path.resolve(values.model ?? DEFAULT_MODEL_PATH);
  const hash = values["test-hash"] ?? DEFAULT_TEST_HASH;
  const runDir = path.resolve(values["run-dir"] ?? path.join("storage/research/nn", `test-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`));
  const logger = nn.logging.create(path.join(runDir, "evaluation.log"));
  try {
    const modelHash = createHash("sha256").update(await readFile(modelPath)).digest("hex");
    logger.log(`FROZEN existing model=${modelPath}; SHA256=${modelHash}`);
    const result = await nn.assessment.run(hash, modelPath, logger.log);
    const reportPath = path.join(runDir, "report.json");
    await jsonFile.write.atomic(reportPath, { status: result.status, modelHash, modelPath, testHash: hash, fingerprint: result.fingerprint, testMetrics: result.metrics });
    logger.log(`REPORT ${reportPath}; outcome=${result.status}`);
    if (result.status === "failed") process.exitCode = 2;
  } catch (error) {
    logger.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally { logger.close(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
