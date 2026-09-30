"use client";

import { Box, Typography } from "@mui/material";
import {
  buildMaxEntryVolumeTooltip,
  estimateMaxEntryFromVolume24h,
  formatVolume24h,
} from "../../volatility/LatestVolatilityPoints";
import { positionData } from "@/lib/system/trading";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import { MetricTooltip } from "./cells";
import { formatNumber, formatUsdt } from "./format";

export default function PositionMetricsGrid({
  maxEntryBased24HourVolPct,
  position,
  volume24h,
}: {
  maxEntryBased24HourVolPct: number;
  position: RuntimeHistoryPosition;
  volume24h?: number;
}) {
  const estimatedMaxEntry = estimateMaxEntryFromVolume24h({
    maxEntryBased24HourVolPct,
    volume24h,
  });
  const maxEntryTooltip = buildMaxEntryVolumeTooltip({
    estimatedMaxEntry,
    maxEntryBased24HourVolPct,
    volume24h,
  });

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          sm: "repeat(3, minmax(0, 1fr))",
          md: "repeat(5, minmax(0, 1fr))",
        },
        gap: 1.5,
        mt: 1.5,
        mb: 1.5,
      }}
    >
      <MetricTooltip title="Quantity of the base asset or futures contract size held by this position.">
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem", display: "block" }}
          >
            Quantity
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
          >
            {formatNumber(position.exposure.quantity, 6)}
          </Typography>
        </Box>
      </MetricTooltip>

      <MetricTooltip title="position.exposure.notionalUsdt. SPOT: quote value. FUTURES: leveraged notional size, usually margin multiplied by leverage.">
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem", display: "block" }}
          >
            Size (USDT)
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
          >
            {formatUsdt(position.exposure.notionalUsdt)}
          </Typography>
        </Box>
      </MetricTooltip>

      {position.exposure.leverage && position.exposure.leverage > 1 ? (
        <>
          <MetricTooltip title="Futures leverage multiplier used to derive size from margin.">
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: "0.7rem", display: "block" }}
              >
                Lev
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
              >
                {position.exposure.leverage}x
              </Typography>
            </Box>
          </MetricTooltip>

          <MetricTooltip title="position.exposure.marginUsdt. Wallet capital locked for this futures position.">
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: "0.7rem", display: "block" }}
              >
                Margin (USDT)
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
              >
                {formatUsdt(position.exposure.marginUsdt ?? 0)}
              </Typography>
            </Box>
          </MetricTooltip>
        </>
      ) : null}

      <MetricTooltip title="position.fees. Open positions show paid entry fee plus estimated exit fee. Closed positions show realized entry plus exit fees.">
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem", display: "block" }}
          >
            Fee (USDT)
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
          >
            {formatUsdt(positionData.fees.totalUsdt(position))}
          </Typography>
        </Box>
      </MetricTooltip>

      <MetricTooltip title="Latest known 24h quote volume for this coin from the dashboard ticker snapshot.">
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem", display: "block" }}
          >
            24h Vol
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
          >
            {formatVolume24h(volume24h)}
          </Typography>
        </Box>
      </MetricTooltip>

      <MetricTooltip title={maxEntryTooltip}>
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem", display: "block" }}
          >
            Max Entry
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
          >
            {formatVolume24h(estimatedMaxEntry)}
          </Typography>
        </Box>
      </MetricTooltip>
    </Box>
  );
}
