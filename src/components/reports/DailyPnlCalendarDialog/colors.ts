/** Maps Trade Sharpe to its conventional qualitative color band. */
export function getTradeSharpeColor(
  value: number | null,
): "default" | "error" | "warning" | "success" {
  if (value === null) return "default";
  if (value < 1) return "error";
  return value < 2 ? "warning" : "success";
}

/** Returns the semantic text color for a daily win rate. */
export function getDailyWinRateColor(
  winRate: number,
): "error.main" | "warning.main" | "success.main" {
  if (winRate < 70) {
    return "error.main";
  }

  return winRate < 90 ? "warning.main" : "success.main";
}

/** Maps a day's monthly PnL contribution to a visible calendar tint. */
export function getDailyPnlTintOpacity(monthlyPnlShare: number): number {
  const normalizedShare = Math.min(1, Math.max(0, monthlyPnlShare));

  return 0.08 + Math.sqrt(normalizedShare) * 0.5;
}
