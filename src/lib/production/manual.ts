import monitoring from "@/lib/precision/monitoring";
import type {
  RuntimeManualPassResult,
} from "@/lib/precision/monitoring/manual";
import singleton from "./singleton";

function normalizeSymbol(symbol: string): string {
  return String(symbol || "").trim().toUpperCase();
}

/**
 * Runs one unconditional pass over the production runtime: monitoring stages
 * plus the default entry capture, regardless of the stage schedule.
 */
async function runPass(params?: {
  bypass?: boolean;
}): Promise<RuntimeManualPassResult> {
  const runtime = singleton.get();
  return runtime.runManual(
    (context) =>
      monitoring.manual.run(context, { bypass: params?.bypass }),
    { overrideRunnerGate: true },
  );
}

/**
 * Forces an operator entry on one symbol for one account. The decision is
 * level-gated like a normal signal unless `bypass` relaxes it to any
 * non-neutral latest point.
 */
async function forceEntry(params: {
  accountSlug: string;
  symbol: string;
  bypass?: boolean;
}): Promise<RuntimeManualPassResult> {
  const runtime = singleton.get();
  const symbol = normalizeSymbol(params.symbol);
  return runtime.runManual(
    (context) =>
      monitoring.manual.run(context, {
        bypass: params?.bypass,
        disableEntry: true,
        forceEntries: [
          { accountSlug: params.accountSlug, symbols: [symbol] },
        ],
      }),
    { overrideRunnerGate: true },
  );
}

/**
 * Forces an operator exit on one symbol. The position's `control.forceExit`
 * flag flows through the shared exit decision and adapter gates.
 */
async function forceExit(params: {
  accountSlug?: string;
  symbol: string;
}): Promise<RuntimeManualPassResult> {
  const runtime = singleton.get();
  const symbol = normalizeSymbol(params.symbol);
  return runtime.runManual(
    (context) =>
      monitoring.manual.run(context, {
        disableEntry: true,
        forceExits: [
          { accountSlug: params.accountSlug, symbols: [symbol] },
        ],
      }),
    { overrideRunnerGate: true },
  );
}

/** Grouped manual operations over the production runtime for API routes. */
const productionManual = {
  entry: forceEntry,
  exit: forceExit,
  run: runPass,
} as const;

export default productionManual;
export { productionManual };
export type { RuntimeManualPassResult };
