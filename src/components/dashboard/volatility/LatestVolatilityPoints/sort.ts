import type { LatestVolatilityPointTableRow, SortKey } from "./columns";

function compareNullableNumber(
  left: number | undefined,
  right: number | undefined,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

/** Sorts latest volatility rows by the clicked table header. */
export function compareLatestVolatilityPointRows(
  left: LatestVolatilityPointTableRow,
  right: LatestVolatilityPointTableRow,
  sortKey: SortKey,
) {
  if (sortKey === "symbol") return left.symbol.localeCompare(right.symbol);
  if (sortKey === "price") return left.point.p - right.point.p;
  if (sortKey === "marketCap") {
    return compareNullableNumber(left.marketCapUSD, right.marketCapUSD);
  }
  if (sortKey === "fundingRate") {
    return compareNullableNumber(left.fundingRate?.rate, right.fundingRate?.rate);
  }
  if (sortKey === "entrySequence") {
    return left.entrySequenceCount.total - right.entrySequenceCount.total;
  }
  if (sortKey === "frequency") return left.pointCount - right.pointCount;
  if (sortKey === "metadata") {
    return left.descriptionText.localeCompare(right.descriptionText);
  }
  if (sortKey === "volume") {
    const byVolume = compareNullableNumber(left.volume24h, right.volume24h);
    if (byVolume !== 0) return byVolume;
    return compareNullableNumber(
      left.estimatedMaxEntry,
      right.estimatedMaxEntry,
    );
  }
  if (sortKey === "level") {
    const leftLevel = left.point.lvl ?? 0;
    const rightLevel = right.point.lvl ?? 0;
    const byAbsoluteLevel = Math.abs(leftLevel) - Math.abs(rightLevel);
    if (byAbsoluteLevel !== 0) return byAbsoluteLevel;
    return leftLevel - rightLevel;
  }
  return (left.point.t ?? 0) - (right.point.t ?? 0);
}
