import { subGates } from "@/lib/strategies/default_with_features_gate/features/v4";

const gateKey = "precision-backtest-dataset-gate";
const subGatesKey = "precision-backtest-dataset-v4-subgates";
const hashKey = "precision-backtest-dataset-hash";
const resultHashKey = "precision-backtest-dataset-result-hash";

/** Restores a previously selected dataset run. */
function readHash(): string {
  try {
    const hash = window.localStorage.getItem(hashKey) ?? "";
    return /^[a-f0-9]{64}$/i.test(hash) ? hash : "";
  } catch { return ""; }
}

/** Remembers the dataset run selected in the dropdown. */
function writeHash(hash: string): void {
  try { window.localStorage.setItem(hashKey, hash); } catch { /* Storage can be unavailable. */ }
}

/** Identifies the latest backtest result already seen by this dataset view. */
function readResultHash(): string {
  try { return window.localStorage.getItem(resultHashKey) ?? ""; } catch { return ""; }
}

/** Marks a backtest result as seen after selecting its dataset. */
function writeResultHash(hash: string): void {
  try { window.localStorage.setItem(resultHashKey, hash); } catch { /* Storage can be unavailable. */ }
}

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

const viewStorage = { readGate, readHash, readResultHash, readSubGates, writeGate, writeHash, writeResultHash, writeSubGates } as const;
export default viewStorage;
