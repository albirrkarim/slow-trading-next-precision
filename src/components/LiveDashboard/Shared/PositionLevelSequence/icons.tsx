"use client";

import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import { Box, Tooltip } from "@mui/material";

import type { PositionLastMonitoringStage } from "@/lib/system/trading";

import { levelKey } from "./items";

/** Icon shown beside an averaged level, carrying the stage snapshot at fill time. */
export function MonitoringStateIcon({
  level,
  monitoringState,
}: {
  level: number;
  monitoringState: PositionLastMonitoringStage;
}) {
  const isSpeedup = monitoringState.stage === "speedup";
  const stageLabel = isSpeedup ? "Speedup" : "Standard";
  const Icon = isSpeedup ? SpeedRoundedIcon : ScheduleRoundedIcon;

  return (
    <Tooltip
      arrow
      placement="top"
      title={`${stageLabel} was the last monitoring stage when this averaging execution was recorded. ${monitoringState.reason} Last updated: ${new Date(monitoringState.lastUpdated).toLocaleString()}`}
    >
      <Box
        aria-label={`${stageLabel} monitoring state at averaging level ${levelKey(level)}`}
        component="span"
        sx={{
          alignItems: "center",
          color: isSpeedup ? "warning.main" : "text.secondary",
          display: "inline-flex",
          mx: 0.25,
        }}
      >
        <Icon sx={{ fontSize: 15 }} />
      </Box>
    </Tooltip>
  );
}

/** Icon embedded inside the exit chip, carrying the stage at close. */
export function ExitMonitoringStageIcon({
  level,
  monitoringState,
}: {
  level: number;
  monitoringState: PositionLastMonitoringStage;
}) {
  const isSpeedup = monitoringState.stage === "speedup";
  const stageLabel = isSpeedup ? "Speedup" : "Standard";
  const Icon = isSpeedup ? SpeedRoundedIcon : ScheduleRoundedIcon;

  return (
    <Tooltip
      arrow
      placement="top"
      title={monitoringState.reason.trim() || "No monitoring reason recorded."}
    >
      <Box
        aria-label={`${stageLabel} monitoring stage at exit level ${levelKey(level)}`}
        component="span"
        role="img"
        sx={{
          alignItems: "center",
          color: isSpeedup ? "warning.light" : "inherit",
          cursor: "help",
          display: "inline-flex",
          ml: 0.375,
        }}
        tabIndex={0}
      >
        <Icon aria-hidden sx={{ fontSize: 12 }} />
      </Box>
    </Tooltip>
  );
}
