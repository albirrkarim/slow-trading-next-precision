"use client";

import { Box, Paper, Typography } from "@mui/material";

import { calculateVPointLevelHeatPct } from "@/components/charts/VPointsFrequency/summary";
import FrequencyHeatRow from "@/components/ui/FrequencyHeatRow";
import type { FeatureGateScoreDistribution } from "@/lib/dev/feature-gate";

import MetricValue from "./MetricValue";

/** Numeric score keys sorted ascending — every score 0..highest present. */
function scoreKeys(distribution: FeatureGateScoreDistribution): number[] {
  const highest = Math.max(
    -1,
    ...Object.keys(distribution)
      .map(Number)
      .filter(Number.isInteger),
  );
  return Array.from({ length: highest + 1 }, (_, score) => score);
}

export default function ScoreDistribution({ distribution }: { distribution: FeatureGateScoreDistribution }) {
  const scores = scoreKeys(distribution);
  const total = scores.reduce(
    (sum, score) => sum + (distribution[score] ?? 0),
    0,
  );
  const maximumCount = Math.max(
    0,
    ...scores.map((score) => distribution[score] ?? 0),
  );

  return (
    <Box role="group" aria-label="Accepted score distribution">
      <Typography fontWeight={700} sx={{ mt: 1.5 }} variant="body2">Accepted score distribution</Typography>
      <Typography component="div" color="text.secondary" variant="caption">
        <MetricValue detail={`Accepted resolved rows = ${scores.map((score) => distribution[score] ?? 0).join(" + ") || "0"}. Unresolved rows are excluded.`}>
          {total.toLocaleString()} accepted resolved rows
        </MetricValue>
      </Typography>
      <Paper variant="outlined" sx={{ mt: 0.75 }}>
        {scores.map((score, index) => {
          const count = distribution[score] ?? 0;
          const share = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "n/a";
          return (
            <FrequencyHeatRow
              key={score}
              index={index}
              heatPct={calculateVPointLevelHeatPct({ count, maximumCount })}
            >
              <Typography variant="body2">Score {score}</Typography>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, fontVariantNumeric: "tabular-nums" }}>
                <MetricValue detail={`Count of accepted resolved rows with miss score equal to ${score}. Shaded width = bucket count / largest bucket count × 100.`}>
                  <Typography component="span" fontWeight={700} variant="body2">{count.toLocaleString()}</Typography>
                </MetricValue>
                <MetricValue detail={`Bucket count / accepted resolved rows × 100 = ${count} / ${total} × 100 = ${share}. Unresolved rows are excluded; n/a when no accepted rows are resolved.`}>
                  <Typography component="span" color="text.secondary" variant="caption">{share}</Typography>
                </MetricValue>
              </Box>
            </FrequencyHeatRow>
          );
        })}
        <Box
          sx={{
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            fontVariantNumeric: "tabular-nums",
            justifyContent: "space-between",
            px: 1,
            py: 0.75,
          }}
        >
          <MetricValue
            detail={`Sum of actual miss scores / accepted resolved rows (${total}). n/a when none exist.`}
          >
            <Typography color="text.secondary" component="span" variant="body2">
              Average score
            </Typography>
          </MetricValue>
          <Typography component="span" fontWeight={700} variant="body2">
            {distribution.avgScore?.toFixed(2) ?? "n/a"}
          </Typography>
        </Box>
        <Box
          sx={{
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            fontVariantNumeric: "tabular-nums",
            justifyContent: "space-between",
            px: 1,
            py: 0.75,
          }}
        >
          <MetricValue detail="Maximum actual miss score among accepted resolved rows; n/a when none exist.">
            <Typography color="text.secondary" component="span" variant="body2">
              Worst score
            </Typography>
          </MetricValue>
          <Typography component="span" fontWeight={700} variant="body2">
            {distribution.worstScore?.toString() ?? "n/a"}
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
