
/**
 * Linear rescale: finds the value that sits at the same relative position
 * inside `[targetMin, targetMax]` as `value` sits inside
 * `[sourceMin, sourceMax]` — e.g. `mapRange(0.3, 0.3, 0.8, 0.1, 1)` returns
 * `0.1`, the extreme-zone equivalent of the normal-zone floor.
 *
 * Signs are irrelevant — only the relative position counts, so negative
 * source values map onto positive targets naturally. A *descending* source
 * interval (`sourceMin > sourceMax`) inverts the mapping — deeper inputs
 * produce deeper outputs: `mapRange(-0.5, 0.3, -2, 3, 5)` returns ≈`3.7`
 * because `-0.5` sits ~35% of the way from `0.3` down to `-2`, and
 * `mapRange(-2, -1, -5, 1, 5)` returns `2` — `-2` is 25% of the way from
 * `-1` down to `-5`, landing 25% of the way from `1` up to `5`. An inverted
 * target range mirrors the input the same way.
 *
 * Values outside the source range extrapolate proportionally (no clamping —
 * `mapRange(1.3, 0.3, -2, 3, 5)` returns ≈`2.6`). A degenerate source range
 * (`sourceMin === sourceMax`) returns `targetMin`.
 */
export function mapRange(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
): number {
  if (sourceMax === sourceMin) return targetMin;
  const ratio = (value - sourceMin) / (sourceMax - sourceMin);
  return targetMin + ratio * (targetMax - targetMin);
}