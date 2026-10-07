"use client";

import { Box, Paper, Typography } from "@mui/material";

import { calculateVPointLevelHeatPct } from "@/components/charts/VPointsFrequency/summary";
import FrequencyHeatRow from "@/components/ui/FrequencyHeatRow";
import type { FeatureGateScoreDistribution } from "@/lib/dev/feature-gate";

import MetricValue from "./MetricValue";

const SCORES = ["0", "1", "2", "3+"] as const;

export default function ScoreDistribution({ distribution }: { distribution: FeatureGateScoreDistribution }) {
  const total = SCORES.reduce((sum, score) => sum + distribution[score], 0);
  const maximumCount = Math.max(...SCORES.map((score) => distribution[score]));

  return (
    <Box role="group" aria-label="Accepted score distribution">
      <Typography fontWeight={700} sx={{ mt: 1.5 }} variant="body2">Accepted score distribution</Typography>
      <Typography component="div" color="text.secondary" variant="caption">
        <MetricValue detail={`Accepted resolved rows = score 0 + score 1 + score 2 + score 3+ = ${distribution["0"]} + ${distribution["1"]} + ${distribution["2"]} + ${distribution["3+"]}. Unresolved rows are excluded.`}>
          {total.toLocaleString()} accepted resolved rows
        </MetricValue>
      </Typography>
      <Paper variant="outlined" sx={{ mt: 0.75 }}>
        {SCORES.map((score, index) => {
          const count = distribution[score];
          const share = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "n/a";
          return (
            <FrequencyHeatRow
              key={score}
              index={index}
              heatPct={calculateVPointLevelHeatPct({ count, maximumCount })}
            >
              <Typography variant="body2">Score {score}</Typography>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, fontVariantNumeric: "tabular-nums" }}>
                <MetricValue detail={`Count of accepted resolved rows with miss score ${score === "3+" ? "at least 3" : `equal to ${score}`}. Shaded width = bucket count / largest bucket count × 100.`}>
                  <Typography component="span" fontWeight={700} variant="body2">{count.toLocaleString()}</Typography>
                </MetricValue>
                <MetricValue detail={`Bucket count / accepted resolved rows × 100 = ${count} / ${total} × 100 = ${share}. Unresolved rows are excluded; n/a when no accepted rows are resolved.`}>
                  <Typography component="span" color="text.secondary" variant="caption">{share}</Typography>
                </MetricValue>
              </Box>
            </FrequencyHeatRow>
          );
        })}
      </Paper>
    </Box>
  );
}
