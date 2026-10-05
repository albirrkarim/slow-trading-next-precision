import { CoinFeatures } from "@/lib/features";

/** Compact date tag for gate messages, e.g. " on 2026-09-25". */
export function formatDayTag(t?: number): string {
  return t === undefined
    ? ""
    : ` on ${new Date(t).toISOString().slice(0, 10)}`;
}

/**
 * Returns the freshest `priceNormalized` sample outside `[min, max]`,
 * scanning the current value first then the history trail newest-to-oldest
 * — limited to samples at or after `cutoffMs` (the judge window; the
 * recorded trail itself reaches further back). Absent values are "no
 * opinion" — never a violation.
 */
export function outsideBounds(
  coin: CoinFeatures | undefined,
  min: number,
  max: number,
  cutoffMs: number,
): { p: number; t?: number } | undefined {
  if (!coin) return undefined;
  const current = coin.priceNormalized;
  if (current !== undefined && (current < min || current > max)) {
    return { p: current };
  }

  for (const { p, t } of [...coin.priceNormalizedHistory].reverse()) {
    if (t < cutoffMs) break;
    if (p < min || p > max) return { p, t };
  }
  return undefined;
}