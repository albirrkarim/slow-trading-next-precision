"use client";

import { alpha, Box, Tooltip, Typography } from "@mui/material";

import type {
  VPointLevelMaxDrawdown,
  VPointLevelProgression,
} from "./summary";
import {
  buildVPointLevelMaxDrawdownTooltip,
  formatLevelMaxDrawdown,
} from "./summary";

const MAX_TOOLTIP_SYMBOLS = 40;

export function VPointLevelRow(props: {
  count: number;
  heatPct: number;
  index: number;
  level: number;
  maxDrawdown: VPointLevelMaxDrawdown | undefined;
  progressions: VPointLevelProgression[];
  symbolCounts: Map<string, number> | undefined;
}) {
  const {
    count,
    heatPct,
    index,
    level,
    maxDrawdown,
    progressions,
    symbolCounts,
  } = props;
  const maxDrawdownTooltip = buildVPointLevelMaxDrawdownTooltip(
    level,
    maxDrawdown,
  );
  const levelSymbolEntries = [
    ...(symbolCounts?.entries() ?? []),
  ].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const visibleSymbols = levelSymbolEntries.slice(0, MAX_TOOLTIP_SYMBOLS);
  const levelSymbolsTooltip = levelSymbolEntries.length > 0 ? (
    <Box component="span" sx={{ display: "block", textAlign: "left" }}>
      <Box
        component="span"
        sx={{ display: "block", fontWeight: 700, mb: 0.25 }}
      >
        {levelSymbolEntries.length} coin
        {levelSymbolEntries.length === 1 ? "" : "s"}
      </Box>
      {visibleSymbols.map(([symbol, symbolCount]) => (
        <Box component="span" key={symbol} sx={{ display: "block" }}>
          {symbol.replace(/_USDT$/, "")} ×{" "}
          {symbolCount.toLocaleString()}
        </Box>
      ))}
      {levelSymbolEntries.length > visibleSymbols.length && (
        <Box component="span" sx={{ display: "block" }}>
          +{levelSymbolEntries.length - visibleSymbols.length} more
        </Box>
      )}
    </Box>
  ) : undefined;

  return (
    <Box
      sx={{
        alignItems: "center",
        borderTop: index === 0 ? 0 : 1,
        borderColor: "divider",
        backgroundImage: (theme) =>
          `linear-gradient(to left, ${alpha(theme.palette.primary.main, 0.28)}, ${alpha(theme.palette.primary.main, 0.08)} 68%, transparent)`,
        backgroundPosition: "right center",
        backgroundRepeat: "no-repeat",
        backgroundSize: `${heatPct}% 100%`,
        display: "flex",
        justifyContent: "space-between",
        px: 1.25,
        py: 0.75,
      }}
    >
      <Box
        sx={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: 0.75,
          minWidth: 0,
          pr: 1,
        }}
      >
        <Typography variant="body2">Level {level}</Typography>
        <Tooltip arrow enterTouchDelay={0} title={maxDrawdownTooltip}>
          <Typography
            aria-label={maxDrawdownTooltip}
            color="text.secondary"
            component="span"
            sx={{
              borderBottom: "1px dotted",
              cursor: "help",
              lineHeight: 1.35,
            }}
            tabIndex={0}
            variant="caption"
          >
            {formatLevelMaxDrawdown(maxDrawdown)}
          </Typography>
        </Tooltip>
      </Box>
      <Box
        sx={{
          alignItems: "baseline",
          display: "flex",
          gap: 0.75,
          whiteSpace: "nowrap",
        }}
      >
        <Tooltip arrow enterTouchDelay={0} title={levelSymbolsTooltip}>
          <Typography
            fontWeight={700}
            sx={{ cursor: "help" }}
            variant="body2"
          >
            {count.toLocaleString()}
          </Typography>
        </Tooltip>
        {progressions.map(
          ({
            direction,
            exactPct,
            pct,
            targetCount,
            targetLevel,
          }) => (
            <Tooltip
              arrow
              key={direction}
              title={`${targetCount.toLocaleString()} / ${count.toLocaleString()} × 100 = ${exactPct.toFixed(2)}% ${direction} to Level ${targetLevel}`}
            >
              <Typography
                color="text.secondary"
                component="span"
                fontWeight={600}
                variant="caption"
              >
                {pct}% {direction}
              </Typography>
            </Tooltip>
          ),
        )}
      </Box>
    </Box>
  );
}
