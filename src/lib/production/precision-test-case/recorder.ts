import path from "path";

import fs from "fs-extra";

import { FILES } from "@/components/storage";
import { windowsMs } from "@/lib/dynamic/constants-time";
import { resolvePersistentStorageRoot } from "@/lib/persistent-storage-root";
import type { RuntimeEngineState } from "@/lib/precision/types";
import slowTradingStorage from "@/lib/slowTrading/storage";
import jsonFile from "@/lib/slowTrading/storage/json-file";

import type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
  PrecisionTestCaseRecordingState,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";

const RECORDING_DIRECTORY = path.join(
  resolvePersistentStorageRoot(),
  "dev",
  "precision-test-case",
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finiteTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Date.now();
}

function cloneConfigWithoutCredentials(
  config: PrecisionTestCase["config"],
): PrecisionTestCase["config"] {
  // A test case is safe to move into backtest tooling; never persist exchange
  // secrets even though the production runtime config contains them.
  const safeConfig = clone(config);
  safeConfig.accounts = safeConfig.accounts.map((account) => ({
    ...account,
    credentials: { apiKey: "", apiSecret: "" },
  }));

  // The production factory projects the full runtime object through a narrow
  // type, so these persisted-only fields may still be present at runtime.
  const runtime = safeConfig.runtime as typeof safeConfig.runtime & {
    exchangeAccounts?: unknown;
  };
  delete runtime.exchangeAccounts;
  runtime.mcp = { tokens: [] };

  return safeConfig;
}

function cropInitialVPoints(
  vPointsMap: RuntimeEngineState["vPointsMap"],
  startTime: number,
): NonNullable<PrecisionTestCase["initialVPointsMap"]> {
  const minimumTime = startTime - windowsMs["1m"] * 2;

  return Object.fromEntries(
    Object.entries(vPointsMap).map(([symbol, points]) => [
      symbol,
      clone(
        points.filter(
          (point) => point.t >= minimumTime && point.t <= startTime,
        ),
      ),
    ]),
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats a test-case filename timestamp as `dd-mm-yyyy-hh-mm` in UTC. */
function formatFileTimestamp(time: number): string {
  const date = new Date(time);
  return [
    pad(date.getUTCDate()),
    pad(date.getUTCMonth() + 1),
    date.getUTCFullYear(),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join("-");
}

function getFileName(
  mode: PrecisionTestCaseMode,
  startTime: number,
  endTime: number | undefined,
): string {
  return `${mode}-${formatFileTimestamp(startTime)}-${
    endTime === undefined ? "undefined" : formatFileTimestamp(endTime)
  }.json`;
}

async function readRecordingState(): Promise<PrecisionTestCaseRecordingState> {
  if (!(await fs.pathExists(FILES.slow.precisionTestCase))) {
    return { recording: false };
  }

  const value = await fs.readJSON(FILES.slow.precisionTestCase);
  if (!value || typeof value !== "object") {
    return { recording: false };
  }

  return value as PrecisionTestCaseRecordingState;
}

async function writeRecordingState(
  state: PrecisionTestCaseRecordingState,
): Promise<void> {
  await jsonFile.write.atomic(FILES.slow.precisionTestCase, state);
}

async function getStatus(
  state?: RuntimeEngineState,
): Promise<PrecisionTestCaseStatus> {
  const recordingState = await readRecordingState();
  if (!recordingState.recording || !recordingState.mode) {
    return { recording: false, tradeHistoryLength: 0 };
  }

  let tradeHistoryLength = 0;
  if (state && recordingState.startTime !== undefined) {
    const endTime = Math.max(
      recordingState.startTime,
      finiteTime(state.currentTime),
    );
    tradeHistoryLength = (
      await slowTradingStorage.history.readRange({
        endTime,
        mode: recordingState.mode,
        startTime: recordingState.startTime,
      })
    ).length;
  }

  return {
    fileName: recordingState.fileName,
    mode: recordingState.mode,
    recording: true,
    startTime: recordingState.startTime,
    tradeHistoryLength,
  };
}

async function start(
  state: RuntimeEngineState,
): Promise<PrecisionTestCaseStatus> {
  // PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
  const recordingState = await readRecordingState();
  if (recordingState.recording) {
    throw new Error("A precision production test case is already recording.");
  }

  if (state.mode !== "live" && state.mode !== "sandbox") {
    throw new Error(
      "Precision test cases can only be recorded in production mode.",
    );
  }

  const startTime = finiteTime(state.currentTime);
  const fileName = getFileName(state.mode, startTime, undefined);
  const testCase: PrecisionTestCase = {
    config: cloneConfigWithoutCredentials(state.config),
    initialVPointsMap: cropInitialVPoints(state.vPointsMap, startTime),
    startTime,
    tradeHistory: [],
  };
  const filePath = path.join(RECORDING_DIRECTORY, fileName);

  await fs.ensureDir(RECORDING_DIRECTORY);
  await jsonFile.write.atomic(filePath, testCase);

  try {
    await writeRecordingState({
      fileName,
      mode: state.mode,
      recording: true,
      startTime,
    });
  } catch (error) {
    await fs.remove(filePath).catch(() => undefined);
    throw error;
  }

  return getStatus(state);
}

async function end(state: RuntimeEngineState): Promise<PrecisionTestCaseResult> {
  const recordingState = await readRecordingState();
  if (
    !recordingState.recording ||
    !recordingState.mode ||
    recordingState.startTime === undefined ||
    !recordingState.fileName
  ) {
    throw new Error("No precision production test case is recording.");
  }

  const startTime = recordingState.startTime;
  const endTime = Math.max(startTime, finiteTime(state.currentTime));
  const pendingPath = path.join(RECORDING_DIRECTORY, recordingState.fileName);
  if (!(await fs.pathExists(pendingPath))) {
    throw new Error(
      `Recording test case file is missing: ${recordingState.fileName}`,
    );
  }

  const initialTestCase = (await fs.readJSON(pendingPath)) as PrecisionTestCase;
  const tradeHistory = await slowTradingStorage.history.readRange({
    endTime,
    mode: recordingState.mode,
    startTime,
  });
  const testCase: PrecisionTestCase = {
    ...initialTestCase,
    endTime,
    tradeHistory: clone(tradeHistory),
  };
  const fileName = getFileName(recordingState.mode, startTime, endTime);
  const filePath = path.join(RECORDING_DIRECTORY, fileName);

  // PROD:PRODUCTION_TEST_CASE
  await jsonFile.write.atomic(filePath, testCase);
  await writeRecordingState({ recording: false });
  await fs.remove(pendingPath);

  return { fileName, path: filePath, testCase };
}

const recorder = {
  end,
  getStatus,
  start,
} as const;

export default recorder;
export { recorder };
export type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
  PrecisionTestCaseRecordingState,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";
