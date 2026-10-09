import { subGates } from "@/lib/strategies/default_with_features_gate/features/v4";

const gateKey = "precision-backtest-dataset-gate";
const subGatesKey = "precision-backtest-dataset-v4-subgates";

/** Restores the selected gate version when browser storage is available. */
function readGate(): string {
  try { return window.localStorage.getItem(gateKey) ?? ""; } catch { return ""; }
}

/** Saves the selected gate version. */
function writeGate(slug: string): void {
  try { window.localStorage.setItem(gateKey, slug); } catch { /* Storage can be unavailable. */ }
}

/** Restores valid v4 checks, including an intentionally empty selection. */
function readSubGates(): string[] {
  try {
    const raw = window.localStorage.getItem(subGatesKey);
    if (raw === null) return [...subGates];
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return [...subGates];
    return subGates.filter((gate) => stored.includes(gate));
  } catch { return [...subGates]; }
}

/** Saves the v4 check combination in its canonical order. */
function writeSubGates(enabled: string[]): void {
  try { window.localStorage.setItem(subGatesKey, JSON.stringify(subGates.filter((gate) => enabled.includes(gate)))); }
  catch { /* Storage can be unavailable. */ }
}

const viewStorage = { readGate, readSubGates, writeGate, writeSubGates } as const;
export default viewStorage;
