import { parseArgs } from "node:util";
import path from "node:path";

import nn from "@/lib/dev/nn";
import { DEFAULT_MODEL_PATH, DEFAULT_OPTIONS, DEFAULT_TEST_HASH, DEFAULT_TRAIN_HASH } from "@/lib/dev/nn/run";

/** Validates numeric CLI settings before loading any dataset. */
function number(value: string | undefined, fallback: number, name: string, min: number, max: number, integer = false): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`--${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`);
  }
  return parsed;
}

/** Runs reproducible NN training with persistent, human-readable logs and an optional frozen final test. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: "boolean" }, test: { type: "boolean" },
    "train-hash": { type: "string" }, "test-hash": { type: "string" }, model: { type: "string" }, "run-dir": { type: "string" },
    epochs: { type: "string" }, seeds: { type: "string" }, hidden: { type: "string" }, "batch-size": { type: "string" },
    "learning-rate": { type: "string" }, l2: { type: "string" }, validation: { type: "string" }, "gap-hours": { type: "string" },
    patience: { type: "string" }, "log-every": { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: npm run nn:train -- [options]

Train and export v3: npm run nn:train
Include one final held-out test: npm run nn:train -- --test
Example: npm run nn:train -- --epochs 400 --seeds 17,29,43 --hidden 16,8

--train-hash HASH    Training dataset (default ${DEFAULT_TRAIN_HASH})
--test              Evaluate the frozen model on the test hash after training
--test-hash HASH     Final-test hash (default ${DEFAULT_TEST_HASH}); also enables final testing
--model PATH        Model output (default ${DEFAULT_MODEL_PATH})
--run-dir PATH      Logs/report/model copy (default unique storage/research/nn directory)
--epochs N          Maximum epochs per seed (default ${DEFAULT_OPTIONS.epochs})
--seeds N,N,N       Deterministic model seeds (default ${DEFAULT_OPTIONS.seeds})
--hidden N,N        Tanh hidden-layer widths (default ${DEFAULT_OPTIONS.hidden})
--batch-size N      Mini-batch size (default ${DEFAULT_OPTIONS.batchSize})
--learning-rate N   Adam learning rate (default ${DEFAULT_OPTIONS.learningRate})
--l2 N              Weight regularization (default ${DEFAULT_OPTIONS.l2})
--validation N      Latest training fraction for validation (default ${DEFAULT_OPTIONS.validationFraction})
--gap-hours N       Gap before validation; crossing labels also purged (default 24)
--patience N        Stop after N epochs without objective improvement (default ${DEFAULT_OPTIONS.patience})
--log-every N       Periodic epoch interval; improvements always logged (default ${DEFAULT_OPTIONS.logEvery})

Exit codes: 0 = trained/test passed, 1 = error, 2 = final-test criterion failed, 130 = interrupted.
V2 and the trading configuration are unchanged. No test data is used for tuning.`);
    return;
  }
  const options = {
    ...DEFAULT_OPTIONS,
    epochs: number(values.epochs, DEFAULT_OPTIONS.epochs, "epochs", 1, 10000, true),
    batchSize: number(values["batch-size"], DEFAULT_OPTIONS.batchSize, "batch-size", 1, 4096, true),
    learningRate: number(values["learning-rate"], DEFAULT_OPTIONS.learningRate, "learning-rate", 0.000001, 1),
    l2: number(values.l2, DEFAULT_OPTIONS.l2, "l2", 0, 10),
    validationFraction: number(values.validation, DEFAULT_OPTIONS.validationFraction, "validation", 0.01, 0.49),
    gapMs: number(values["gap-hours"], 24, "gap-hours", 0, 8760) * 3_600_000,
    patience: number(values.patience, DEFAULT_OPTIONS.patience, "patience", 1, 10000, true),
    logEvery: number(values["log-every"], DEFAULT_OPTIONS.logEvery, "log-every", 1, 10000, true),
    seeds: values.seeds ? values.seeds.split(",").map((value) => number(value, 0, "seeds", 0, 4294967295, true)) : [...DEFAULT_OPTIONS.seeds],
    hidden: values.hidden ? values.hidden.split(",").map((value) => number(value, 0, "hidden", 1, 256, true)) : [...DEFAULT_OPTIONS.hidden],
  };
  if (options.hidden.length > 4 || options.seeds.length > 20) throw new Error("Use at most four hidden layers and twenty seeds.");
  const runDir = path.resolve(values["run-dir"] ?? path.join("storage/research/nn", `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`));
  const logger = nn.logging.create(path.join(runDir, "training.log"));
  const controller = new AbortController();
  const interrupt = () => { logger.log("INTERRUPTED — stopping at the next epoch boundary"); controller.abort(new Error("Training interrupted")); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    logger.log(`LOG ${path.join(runDir, "training.log")}`);
    const result = await nn.run({
      trainHash: values["train-hash"] ?? DEFAULT_TRAIN_HASH,
      testHash: values.test || values["test-hash"] ? values["test-hash"] ?? DEFAULT_TEST_HASH : undefined,
      modelPath: path.resolve(values.model ?? DEFAULT_MODEL_PATH), runDir, options, log: logger.log, signal: controller.signal,
    });
    if (result.status === "failed") process.exitCode = 2;
  } catch (error) {
    logger.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    logger.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
