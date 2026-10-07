import { parseArgs } from "node:util";
import path from "node:path";

import nn from "@/lib/dev/nn";
import type { NeuralTrainingOptions } from "@/lib/dev/nn";
import { DEFAULT_MODEL_PATH, DEFAULT_OPTIONS, DEFAULT_TEST_HASH, DEFAULT_TRAIN_HASH } from "@/lib/dev/nn/run";
import hardRules from "@/lib/strategies/default_with_features_gate/features/v3/hard-rules";
import type { NeuralHardRule } from "@/lib/strategies/default_with_features_gate/features/v3/hard-rules";

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
    help: { type: "boolean" }, test: { type: "boolean" }, research: { type: "boolean" },
    backend: { type: "string" }, python: { type: "string" }, activation: { type: "string" }, dropout: { type: "string" },
    "learning-target": { type: "string" }, "dataset-dir": { type: "string" }, "hard-rules": { type: "string" }, objective: { type: "string" }, "fit-eligible": { type: "boolean" }, calibration: { type: "string" },
    profile: { type: "string" }, "cutoff-margin": { type: "string" },
    "train-hash": { type: "string" }, "test-hash": { type: "string" }, model: { type: "string" }, "run-dir": { type: "string" },
    epochs: { type: "string" }, seeds: { type: "string" }, hidden: { type: "string" }, "batch-size": { type: "string" },
    "learning-rate": { type: "string" }, l2: { type: "string" }, validation: { type: "string" }, "gap-hours": { type: "string" },
    patience: { type: "string" }, "log-every": { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: npm run nn:train -- [options]

Train and export v3: npm run nn:train
Include one final held-out test: npm run nn:train -- --test
Search training-only cross-coin experiments, then test once: npm run nn:train -- --research --test --seeds 17
Example: npm run nn:train -- --epochs 400 --seeds 17,29,43 --hidden 16,8

--train-hash HASH    Training dataset (default ${DEFAULT_TRAIN_HASH})
--test              Evaluate the frozen model on the test hash after training
--test-hash HASH     Final-test hash (default ${DEFAULT_TEST_HASH}); also enables final testing
--research          Compare 12 native or 8 Torch families with leave-one-coin-out validation
--backend NAME      native (default) or torch; Torch trains/calibrates one seed-ensemble family across held-out training coins
--python PATH       Torch Python executable (default python3); needs numpy and torch
--activation NAME   Torch hidden activation: relu (default) or tanh
--dropout N         Torch dropout (default 0.1)
--learning-target N Torch binary loss target score>=1, >=2 (default), or >=3; gate audits always require score<3
--objective NAME   Torch binary (default) or ordinal; ordinal adds >=1/2 auxiliary heads and exports >=3 risk
--hard-rules NAMES  Torch hybrid vetoes after NN acceptance, comma-separated: ${hardRules.names.join(", ")}
--fit-eligible      Torch fitting/normalization use only rows passing the fixed hard policy
--calibration NAME  Torch global (default), side-level or hierarchical; sparse groups retain parent cutoffs
--dataset-dir PATH  Optional checksum-verified test snapshot; requires --test/--test-hash
--profile NAME      Preprocessing profile: legacy, directional or contextual (default ${DEFAULT_OPTIONS.profile})
--cutoff-margin N   Conservative multiplier in (0,1] (default ${DEFAULT_OPTIONS.cutoffMargin}); research calibrates its own
--model PATH        Model output (default ${DEFAULT_MODEL_PATH})
--run-dir PATH      Logs/report/model copy (default unique storage/research/nn directory)
--epochs N          Maximum epochs per seed (default ${DEFAULT_OPTIONS.epochs})
--seeds N,N,N       Deterministic model seeds (default ${DEFAULT_OPTIONS.seeds})
--hidden N,N        Hidden-layer widths, or linear; native uses tanh, Torch uses --activation (native default ${DEFAULT_OPTIONS.hidden})
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
  const backend = values.backend ?? "native";
  if (backend !== "native" && backend !== "torch") throw new Error("--backend must be native or torch.");
  if (backend === "native" && (values.python || values.activation || values.dropout || values["learning-target"] || values["hard-rules"] || values.objective || values["fit-eligible"] || values.calibration)) throw new Error("Python/activation/dropout/learning-target/hard-rules/objective/fit-eligible/calibration options require --backend torch.");
  const calibration = values.calibration ?? "global";
  if (calibration !== "global" && calibration !== "side-level" && calibration !== "hierarchical") throw new Error("--calibration must be global, side-level or hierarchical.");
  if (values["fit-eligible"] && !values["hard-rules"]) throw new Error("--fit-eligible requires --hard-rules.");
  const objective = values.objective ?? "binary";
  if (objective !== "binary" && objective !== "ordinal") throw new Error("--objective must be binary or ordinal.");
  if (objective === "ordinal" && values.research) throw new Error("Ordinal currently trains one family; omit --research.");
  const policy = values["hard-rules"]?.split(",");
  if (policy?.some((rule) => !hardRules.names.includes(rule as NeuralHardRule))) throw new Error(`--hard-rules must use ${hardRules.names.join(", ")}.`);
  if (backend === "torch" && values["cutoff-margin"]) throw new Error("Torch uses cross-coin calibration; --cutoff-margin belongs to the native backend.");
  if (values["dataset-dir"] && !values.test && !values["test-hash"]) throw new Error("--dataset-dir requires a final test.");
  const defaults: NeuralTrainingOptions = backend === "torch" ? { ...DEFAULT_OPTIONS, profile: "directional", epochs: 150, batchSize: 128, l2: 0.01, hidden: [32, 16], seeds: [17, 29, 43], patience: 35 } : DEFAULT_OPTIONS;
  const profile = values.profile ?? defaults.profile ?? "legacy";
  if (profile !== "legacy" && profile !== "directional" && profile !== "contextual") throw new Error("--profile must be legacy, directional or contextual.");
  const options: NeuralTrainingOptions = {
    ...defaults,
    profile,
    cutoffMargin: backend === "native" ? number(values["cutoff-margin"], DEFAULT_OPTIONS.cutoffMargin ?? 1, "cutoff-margin", 0.000001, 1) : undefined,
    epochs: number(values.epochs, defaults.epochs, "epochs", 1, 10000, true),
    batchSize: number(values["batch-size"], defaults.batchSize, "batch-size", 1, 4096, true),
    learningRate: number(values["learning-rate"], DEFAULT_OPTIONS.learningRate, "learning-rate", 0.000001, 1),
    l2: number(values.l2, defaults.l2, "l2", 0, 10),
    validationFraction: number(values.validation, DEFAULT_OPTIONS.validationFraction, "validation", 0.01, 0.49),
    gapMs: number(values["gap-hours"], 24, "gap-hours", 0, 8760) * 3_600_000,
    patience: number(values.patience, defaults.patience, "patience", 1, 10000, true),
    logEvery: number(values["log-every"], DEFAULT_OPTIONS.logEvery, "log-every", 1, 10000, true),
    seeds: values.seeds ? values.seeds.split(",").map((value) => number(value, 0, "seeds", 0, 4294967295, true)) : [...defaults.seeds],
    hidden: values.hidden === "linear" ? [] : values.hidden ? values.hidden.split(",").map((value) => number(value, 0, "hidden", 1, 256, true)) : [...defaults.hidden],
  };
  if (options.hidden.length > 4 || options.seeds.length > 20) throw new Error("Use at most four hidden layers and twenty seeds.");
  const runDir = path.resolve(values["run-dir"] ?? path.join("storage/research/nn", `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`));
  const logger = nn.logging.create(path.join(runDir, "training.log"));
  const controller = new AbortController();
  const interrupt = () => { logger.log(backend === "torch" ? "INTERRUPTED — terminating Python worker" : "INTERRUPTED — stopping at the next epoch boundary"); controller.abort(new Error("Training interrupted")); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    logger.log(`LOG ${path.join(runDir, "training.log")}`);
    const params = {
      trainHash: values["train-hash"] ?? DEFAULT_TRAIN_HASH,
      testHash: values.test || values["test-hash"] ? values["test-hash"] ?? DEFAULT_TEST_HASH : undefined,
      modelPath: path.resolve(values.model ?? DEFAULT_MODEL_PATH), runDir, options, log: logger.log, signal: controller.signal,
      snapshotDir: values["dataset-dir"] ? path.resolve(values["dataset-dir"]) : undefined,
    };
    const activation = values.activation ?? "relu";
    if (activation !== "relu" && activation !== "tanh") throw new Error("--activation must be relu or tanh.");
    const result = backend === "torch" ? await (values.research ? nn.research.torch : nn.torch.run)({ ...params, torch: { python: values.python ?? "python3", activation,
      dropout: number(values.dropout, 0.1, "dropout", 0, 0.9), learningTarget: number(values["learning-target"], 2, "learning-target", 1, 3, true) as 1 | 2 | 3, objective, calibration, fitEligible: values["fit-eligible"], hardRules: policy as NeuralHardRule[] | undefined } })
      : await (values.research ? nn.research.run : nn.run)(params);
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
