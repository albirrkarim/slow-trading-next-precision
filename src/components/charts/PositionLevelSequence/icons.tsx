"use client";

import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import { Box, Tooltip } from "@mui/material";

import type { PositionLastMonitoringStage } from "@/lib/system/trading";



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
        aria-label={`${stageLabel} monitoring state at averaging level ${level}`}
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

/** Icon embedded inside the exit chip, marking the stage at close. */
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
    <Box
      aria-label={`${stageLabel} monitoring stage at exit level ${level}`}
      component="span"
      role="img"
      sx={{
        alignItems: "center",
        color: isSpeedup ? "warning.light" : "inherit",
        display: "inline-flex",
        ml: 0.375,
      }}
    >
      <Icon aria-hidden sx={{ fontSize: 12 }} />
    </Box>
  );
}
