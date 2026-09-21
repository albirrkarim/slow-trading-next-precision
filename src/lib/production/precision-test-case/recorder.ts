import path from "path";

import fs from "fs-extra";

import { windowsMs } from "@/lib/dynamic/constants-time";
import type { RuntimeEngineState } from "@/lib/precision/types";
import type { Position } from "@/lib/trading/models";
import { resolvePersistentStorageRoot } from "@/lib/persistent-storage-root";
import jsonFile from "@/lib/slowTrading/storage/json-file";

import type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";

const RECORDING_DIRECTORY = path.join(
  resolvePersistentStorageRoot(),
  "dev",
  "precision-test-case",
);
const TWO_MONTHS_MS = windowsMs["1m"] * 2;

interface RecordingSession {
  mode: PrecisionTestCaseMode;
  startTime: number;
  config: PrecisionTestCase["config"];
  initialVPointsMap: NonNullable<PrecisionTestCase["initialVPointsMap"]>;
  closedPositions: Position[];
}

let activeSession: RecordingSession | undefined;

function clone<T>(value: T): T {
  return structuredClone(value);
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
  return safeConfig;
}

function finiteTime(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function cropInitialVPoints(
  vPointsMap: RuntimeEngineState["vPointsMap"],
  startTime: number,
): NonNullable<PrecisionTestCase["initialVPointsMap"]> {
  const minimumTime = startTime - TWO_MONTHS_MS;

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

function getFileName(mode: PrecisionTestCaseMode, startTime: number, endTime: number): string {
  return `${mode}-${formatFileTimestamp(startTime)}-${formatFileTimestamp(endTime)}.json`;
}

function getStatus(): PrecisionTestCaseStatus {
  if (!activeSession) {
    return { recording: false, tradeHistoryLength: 0 };
  }

  return {
    recording: true,
    mode: activeSession.mode,
    startTime: activeSession.startTime,
    tradeHistoryLength: activeSession.closedPositions.length,
  };
}

function start(state: RuntimeEngineState): PrecisionTestCaseStatus {
  // PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS
  if (activeSession) {
    throw new Error("A precision production test case is already recording.");
  }

  if (state.mode !== "live" && state.mode !== "sandbox") {
    throw new Error("Precision test cases can only be recorded in production mode.");
  }

  const startTime = finiteTime(state.currentTime);
  activeSession = {
    closedPositions: [],
    config: cloneConfigWithoutCredentials(state.config),
    initialVPointsMap: cropInitialVPoints(state.vPointsMap, startTime),
    mode: state.mode,
    startTime,
  };

  return getStatus();
}

/** Retains a closed position while a production test case is recording. */
function recordClosed(position: Position): void {
  if (!activeSession) return;
  activeSession.closedPositions.push(clone(position));
}

async function end(state: RuntimeEngineState): Promise<PrecisionTestCaseResult> {
  if (!activeSession) {
    throw new Error("No precision production test case is recording.");
  }

  const session = activeSession;
  const endTime = Math.max(session.startTime, finiteTime(state.currentTime));
  const testCase: PrecisionTestCase = {
    config: clone(session.config),
    endTime,
    initialVPointsMap: clone(session.initialVPointsMap),
    startTime: session.startTime,
    tradeHistory: [
      ...clone(session.closedPositions),
      ...clone(state.openPositions),
    ],
  };
  const fileName = getFileName(session.mode, session.startTime, endTime);
  const filePath = path.join(RECORDING_DIRECTORY, fileName);

  await fs.ensureDir(RECORDING_DIRECTORY);
  // PROD:PRODUCTION_TEST_CASE
  await jsonFile.write.atomic(filePath, testCase);
  activeSession = undefined;

  return { fileName, path: filePath, testCase };
}

const recorder = {
  end,
  getStatus,
  recordClosed,
  start,
} as const;

export default recorder;
export { recorder };
export type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./types";
