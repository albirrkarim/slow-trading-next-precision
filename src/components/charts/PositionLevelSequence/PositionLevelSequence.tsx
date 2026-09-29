"use client";

import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Alert, Box, Chip, Tooltip } from "@mui/material";

import { ExitMonitoringStageIcon, MonitoringStateIcon } from "./icons";
import {
  buildTooltip,
  formatAveragingMultiplier,
  formatDriftPct,
  getChipProps,
  isReachedWithoutAveraging,
  stateLabels,
} from "./items";
import type { PositionLevelSequenceItem } from "./types";

/** Shared chip renderer for open-position and closed-trade level sequences. */
export default function PositionLevelSequence({
  items,
  showTargetAlert = true,
}: {
  items: PositionLevelSequenceItem[];
  showTargetAlert?: boolean;
}) {
  // BOTH:REUSABLE_LEVEL_SEQUENCE
  const targetWasHit = items.some((item) => item.state === "target");

  if (items.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1 }}
    >
      <Box
        aria-label="Position level sequence"
        sx={{
          alignItems: "center",
          display: "flex",
          maxWidth: "100%",
          minWidth: 0,
          overflowX: "auto",
        }}
      >
        {items.map((item, index) => {
          const attemptFailed =
            Boolean(item.attemptMessage) && !item.isAveraged;
          const baseChipProps = getChipProps(item, targetWasHit);
          // A refused averaging attempt upgrades the chip to warning so the
          // refusal is visible without hovering.
          const chipProps = attemptFailed
            ? { ...baseChipProps, color: "warning" as const }
            : baseChipProps;
          const reachedWithoutAveraging = isReachedWithoutAveraging(
            item,
            targetWasHit,
          );
          const driftLabel = formatDriftPct(item.driftPct);
          const averagingMultiplierLabel = formatAveragingMultiplier(
            item.averagingMultiplier,
          );
          const exitMonitoringState =
            item.isExit || item.state === "exit"
              ? item.exitMonitoringState
              : undefined;
          const exitStageLabel = exitMonitoringState
            ? exitMonitoringState.stage === "speedup"
              ? "Speedup monitoring stage"
              : "Standard monitoring stage"
            : null;
          const statusLabel = [
            `Level ${item.level}`,
            stateLabels[item.state],
            item.isEntry ? "Entry" : null,
            item.isExit && item.state !== "exit" ? "Exit" : null,
            item.isAveraged ? "Averaged" : null,
            reachedWithoutAveraging ? "Not averaged" : null,
            attemptFailed ? "Averaging attempt refused" : null,
            exitStageLabel,
            reachedWithoutAveraging && driftLabel
              ? `Drift ${driftLabel}`
              : null,
            item.state === "unreserved"
              ? item.unreservedCoverage === "full"
                ? "Fully covered"
                : item.unreservedCoverage === "partial"
                  ? "Partially covered"
                  : "Not covered"
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          const chipSuffix = [
            item.isAveraged
              ? ` AVG${
                  averagingMultiplierLabel ? ` ${averagingMultiplierLabel}` : ""
                }`
              : "",
            item.isExit || item.state === "exit" ? " EXIT" : "",
            !item.isAveraged && item.state === "skipped" ? " NOT AVG" : "",
            !item.isAveraged && reachedWithoutAveraging && driftLabel
              ? ` drift ${driftLabel}`
              : "",
          ].join("");
          const chipLabel = `L${item.level}${chipSuffix}`;
          const chip = (
            <Chip
              {...chipProps}
              aria-label={statusLabel}
              label={
                exitMonitoringState || attemptFailed ? (
                  <Box
                    component="span"
                    sx={{ alignItems: "center", display: "inline-flex" }}
                  >
                    {chipLabel}
                    {attemptFailed && (
                      <>
                        <WarningAmberRoundedIcon
                          aria-label="Averaging attempt refused"
                          sx={{ fontSize: 11, ml: 0.375 }}
                        />
                        <Box component="span" sx={{ ml: 0.25 }}>
                          AVG
                        </Box>
                      </>
                    )}
                    {exitMonitoringState && (
                      // BOTH:TRADE_HISTORY_EXIT_MONITORING_STAGE
                      <ExitMonitoringStageIcon
                        level={item.level}
                        monitoringState={exitMonitoringState}
                      />
                    )}
                  </Box>
                ) : (
                  chipLabel
                )
              }
              size="small"
              sx={{
                borderStyle:
                  item.state === "unreserved" ? "dashed" : "solid",
                fontSize: "0.6rem",
                fontWeight: 700,
                height: 18,
                "& .MuiChip-label": { px: 0.75 },
              }}
            />
          );

          return (
            <Box
              key={`${item.level}-${index}`}
              sx={{ alignItems: "center", display: "flex", flexShrink: 0 }}
            >
              {index > 0 && (
                <ArrowForwardRoundedIcon
                  aria-hidden
                  sx={{ color: "text.disabled", fontSize: 14, mx: 0.25 }}
                />
              )}
              {item.monitoringState && (
                <MonitoringStateIcon
                  level={item.level}
                  monitoringState={item.monitoringState}
                />
              )}
              {exitMonitoringState ? (
                chip
              ) : (
                <Tooltip
                  arrow
                  placement="top"
                  title={buildTooltip(item, targetWasHit)}
                >
                  {chip}
                </Tooltip>
              )}
            </Box>
          );
        })}
      </Box>

      {showTargetAlert && targetWasHit && (
        <Alert
          aria-label="Averaging sequence stopped"
          icon={<WarningAmberRoundedIcon fontSize="inherit" />}
          severity="warning"
          variant="outlined"
          sx={{
            alignItems: "center",
            fontSize: "0.65rem",
            fontWeight: 700,
            minHeight: 22,
            py: 0,
            px: 0.75,
            "& .MuiAlert-icon": { mr: 0.5, py: 0 },
            "& .MuiAlert-message": { py: 0.25 },
          }}
        >
          Target vPoint hit; remaining averaging steps stopped
        </Alert>
      )}
    </Box>
  );
}
