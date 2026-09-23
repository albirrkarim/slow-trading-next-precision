/**
 * Expands the configured symbol universe to include helper symbols needed by
 * runtime logic. Symbols are uppercased, deduplicated, and sorted; `BTC` is
 * always present because market-health checks reference it even when it is
 * not traded.
 */
function buildExecution(symbols: string[]): string[] {
  const out = Array.from(
    new Set([...symbols.map((symbol) => symbol.toUpperCase()), "BTC"]),
  );
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

const runtimeSymbols = {
  buildExecution,
} as const;

export default runtimeSymbols;
