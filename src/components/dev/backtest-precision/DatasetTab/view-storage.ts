const gateKey = "precision-backtest-dataset-gate";
const subGatesKey = (slug: string) => `precision-backtest-dataset-${slug}-subgates`;
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

/** Restores valid checks for one gate, including an intentionally empty selection. */
function readSubGates(slug: string, subGateKeys: string[], defaults: readonly string[] = subGateKeys): string[] {
  const fallback = subGateKeys.filter((gate) => defaults.includes(gate));
  try {
    const raw = window.localStorage.getItem(subGatesKey(slug));
    if (raw === null) return fallback;
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return fallback;
    return subGateKeys.filter((gate) => stored.includes(gate));
  } catch { return fallback; }
}

/** Saves one gate's check combination in its canonical order. */
function writeSubGates(slug: string, enabled: string[], subGateKeys: string[]): void {
  try { window.localStorage.setItem(subGatesKey(slug), JSON.stringify(subGateKeys.filter((gate) => enabled.includes(gate)))); }
  catch { /* Storage can be unavailable. */ }
}

const viewStorage = { readGate, readHash, readResultHash, readSubGates, writeGate, writeHash, writeResultHash, writeSubGates } as const;
export default viewStorage;
