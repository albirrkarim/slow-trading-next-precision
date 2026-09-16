import { FILES } from "@/components/storage";
import slowTrading from "@/lib/runtime";
import slowTradingMutationQueue from "@/lib/runtime/mutation-queue";
import slowTradingJsonFile from "@/lib/runtime/storage/json-file";
import type { SlowTradingModeState } from "@/lib/runtime/types";
import type { Position } from "@/lib/trading/models";
import fs from "fs-extra";
import md5 from "md5";
import type {
  PrecisionRunConfigV1,
  PrecisionStrategyId,
  ProdTestCaseV1,
} from "../types";

/** Identifies one process so a restart invalidates in-flight captures. */
const PROCESS_BOOT_ID = `${Date.now().toString(36)}-${process.pid}`;

const REDACTED_VALUE = "[precision:redacted]";

/** Internal marker for one active production test-case capture. */
interface ActiveCaptureRecord {
  schema: 1;
  strategy: PrecisionStrategyId;
  mode: "live" | "sandbox";
  account: string;
  startTime: number;
  bootId: string;
  configFingerprint: string;
  config: PrecisionRunConfigV1;
  initialState: SlowTradingModeState;
}

/** Public summary of one active capture without heavy state payloads. */
export interface PrecisionCaptureStatus {
  mode: "live" | "sandbox";
  strategy: PrecisionStrategyId;
  account: string;
  startTime: number;
}

/** Metadata for one persisted production test case. */
export interface PrecisionTestCaseSummary {
  fileName: string;
  mode: "live" | "sandbox";
  strategy: PrecisionStrategyId;
  startTime: number;
  endTime: number;
  positionCount: number;
}

/** Result of ending one production test-case capture. */
export interface PrecisionCaptureEndResult {
  mode: "live" | "sandbox";
  account: string;
  startTime: number;
  endTime: number;
  positionCount: number;
  fileName: string;
}

/**
 * Serializes a JSON value with sorted object keys so equivalent configs
 * produce the same fingerprint regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

/** Replaces every credential field with a stable redaction marker. */
function redactCredentials(credentials: object) {
  return Object.fromEntries(
    Object.keys(credentials).map((key) => [key, REDACTED_VALUE]),
  );
}

/** Builds a credential-free snapshot of the effective run configuration. */
function buildRedactedRunConfig(storage: {
  config: PrecisionRunConfigV1["trading"];
  runtime: PrecisionRunConfigV1["runtime"];
}): PrecisionRunConfigV1 {
  return {
    runtime: {
      ...JSON.parse(JSON.stringify(storage.runtime)),
      exchangeAccounts: storage.runtime.exchangeAccounts.map((account) => ({
        ...account,
        credentials: redactCredentials(account.credentials),
      })),
    },
    trading: JSON.parse(JSON.stringify(storage.config)),
  };
}

/** Returns the stable fingerprint of a redacted run configuration. */
function fingerprintRunConfig(config: PrecisionRunConfigV1): string {
  return md5(stableStringify(config));
}

/** Converts one persisted position into the canonical V1 precision shape. */
function canonicalizePosition(
  position: Position,
): ProdTestCaseV1["endPositions"][number] {
  return {
    ...position,
    strategyId: "multi",
  };
}

/** Reads and validates one active capture marker. */
async function readActiveCapture(
  mode: "live" | "sandbox",
): Promise<ActiveCaptureRecord> {
  const activePath = FILES.slow.precision.activeCapture(mode);
  const record = (await fs.readJSON(activePath)) as ActiveCaptureRecord;
  if (record?.schema !== 1 || record.mode !== mode) {
    throw new Error(`Invalid active precision capture for ${mode}`);
  }

  return record;
}

/** Starts one production test-case capture under the storage lock. */
async function start(params: {
  account?: string;
  mode?: "live" | "sandbox";
  now?: () => number;
} = {}): Promise<PrecisionCaptureStatus> {
  return slowTradingMutationQueue.runExclusive(async () => {
    const storage = await slowTrading.storage.data.load({
      account: params.account,
      modeScope: "all",
    });
    const mode = params.mode ?? slowTrading.storage.mode.getActive(storage);
    const activePath = FILES.slow.precision.activeCapture(mode);
    if (await fs.pathExists(activePath)) {
      throw new Error(
        `A precision test case capture is already active for ${mode}`,
      );
    }

    const now = params.now ?? Date.now;
    const config = buildRedactedRunConfig(storage);
    const record: ActiveCaptureRecord = {
      schema: 1,
      strategy: "multi",
      mode,
      account: storage.account.slug,
      startTime: now(),
      bootId: PROCESS_BOOT_ID,
      configFingerprint: fingerprintRunConfig(config),
      config,
      initialState: JSON.parse(JSON.stringify(storage.modes[mode])),
    };
    await slowTradingJsonFile.write.atomic(activePath, record);

    return {
      mode,
      strategy: record.strategy,
      account: record.account,
      startTime: record.startTime,
    };
  });
}

/** Ends the active capture, collecting every final position under the lock. */
async function end(params: {
  mode?: "live" | "sandbox";
  now?: () => number;
} = {}): Promise<PrecisionCaptureEndResult> {
  return slowTradingMutationQueue.runExclusive(async () => {
    const candidateModes: Array<"live" | "sandbox"> = params.mode
      ? [params.mode]
      : ["live", "sandbox"];
    const activeModes: Array<"live" | "sandbox"> = [];
    for (const mode of candidateModes) {
      if (
        await fs.pathExists(FILES.slow.precision.activeCapture(mode))
      ) {
        activeModes.push(mode);
      }
    }

    if (activeModes.length === 0) {
      throw new Error("No active precision test case capture");
    }
    if (activeModes.length > 1) {
      throw new Error(
        "Both live and sandbox captures are active; specify which mode to end",
      );
    }

    const mode = activeModes[0];
    const activePath = FILES.slow.precision.activeCapture(mode);
    const record = await readActiveCapture(mode);
    const endTime = (params.now ?? Date.now)();
    const storage = await slowTrading.storage.data.load({
      account: record.account,
      modeScope: "all",
    });
    const currentConfig = buildRedactedRunConfig(storage);
    const currentFingerprint = fingerprintRunConfig(currentConfig);

    if (record.bootId !== PROCESS_BOOT_ID) {
      await fs.remove(activePath);
      throw new Error(
        "Precision test case capture is invalid: process restarted",
      );
    }
    if (record.configFingerprint !== currentFingerprint) {
      await fs.remove(activePath);
      throw new Error(
        "Precision test case capture is invalid: configuration changed",
      );
    }

    const openPositions = storage.modes[mode].tradeSettings.flatMap(
      (tradeSetting) =>
        (tradeSetting.model_memory.positions ?? []).map(canonicalizePosition),
    );
    const closedHistory = await slowTrading.storage.history.readAccounts({
      accountSlugs: [record.account],
      mode,
    });
    const closedPositions = closedHistory
      .filter((position) => {
        const closedAt = position.closed?.t;
        return (
          typeof closedAt === "number" &&
          Number.isFinite(closedAt) &&
          closedAt >= record.startTime &&
          closedAt <= endTime
        );
      })
      .map((position) => {
        const { mode: _historyMode, ...rest } = position;
        return canonicalizePosition(rest);
      });

    const endPositions = [...openPositions, ...closedPositions].sort(
      (left, right) => left.opened.t - right.opened.t,
    );
    const testCase: ProdTestCaseV1 = {
      schema: 1,
      strategy: record.strategy,
      mode,
      startTime: record.startTime,
      endTime,
      config: record.config,
      initialState: record.initialState,
      endPositions,
    };
    const fileName = `${mode}-${record.startTime}-${endTime}.json`;
    await slowTradingJsonFile.write.atomic(
      FILES.slow.precision.testCase(mode, record.startTime, endTime),
      testCase,
    );
    await fs.remove(activePath);

    return {
      mode,
      account: record.account,
      startTime: record.startTime,
      endTime,
      positionCount: endPositions.length,
      fileName,
    };
  });
}

/** Returns the active capture summaries for both production modes. */
async function status(): Promise<{
  live: PrecisionCaptureStatus | null;
  sandbox: PrecisionCaptureStatus | null;
}> {
  const result: {
    live: PrecisionCaptureStatus | null;
    sandbox: PrecisionCaptureStatus | null;
  } = { live: null, sandbox: null };

  for (const mode of ["live", "sandbox"] as const) {
    if (!(await fs.pathExists(FILES.slow.precision.activeCapture(mode)))) {
      continue;
    }
    const record = await readActiveCapture(mode);
    result[mode] = {
      mode,
      strategy: record.strategy,
      account: record.account,
      startTime: record.startTime,
    };
  }

  return result;
}

/** Lists persisted production test cases newest-first. */
async function list(): Promise<PrecisionTestCaseSummary[]> {
  await fs.ensureDir(FILES.slow.precision.testCaseRoot);
  const entries = await fs.readdir(FILES.slow.precision.testCaseRoot);
  const summaries: PrecisionTestCaseSummary[] = [];

  for (const fileName of entries) {
    if (!/^(live|sandbox)-\d+-\d+\.json$/.test(fileName)) {
      continue;
    }
    const testCase = (await fs.readJSON(
      `${FILES.slow.precision.testCaseRoot}/${fileName}`,
    )) as ProdTestCaseV1;
    summaries.push({
      fileName,
      mode: testCase.mode,
      strategy: testCase.strategy,
      startTime: testCase.startTime,
      endTime: testCase.endTime,
      positionCount: testCase.endPositions?.length ?? 0,
    });
  }

  return summaries.sort((left, right) => right.startTime - left.startTime);
}

const precisionCapture = {
  end,
  list,
  start,
  status,
} as const;

export default precisionCapture;
export { precisionCapture };
export type { ActiveCaptureRecord };
