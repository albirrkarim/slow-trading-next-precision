"use client";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Box, Button, Typography } from "@mui/material";

import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import TypographyTooltip from "@/components/ui/TypographyTooltip";
import BlackSwanTimeline, {
  type BlackSwanTimelineVisibleRange,
} from "@/components/reports/BlackSwanTimeline";
import DateSelectionDialog from "@/components/settings/Components/DateSelectionDialog";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";

import type { DashboardConfig, KlineMarker } from "./types";

export default function VolatilitySection(props: {
  config: DashboardConfig;
  dashboardState: RuntimeDashboardState | null;
  data: KlineMarker | null;
  isMobile: boolean;
  loading: boolean;
  onResetVPointUsed: () => void;
  onVolatilityVisibleRange: (range: BlackSwanTimelineVisibleRange) => void;
  resettingVPointUsed: boolean;
  updateConfig: (update: Partial<DashboardConfig>) => void;
  volatilityRange: BlackSwanTimelineVisibleRange | undefined;
}) {
  const {
    config,
    dashboardState,
    data,
    isMobile,
    loading,
    onResetVPointUsed,
    onVolatilityVisibleRange,
    resettingVPointUsed,
    updateConfig,
    volatilityRange,
  } = props;

  return (
    <HeaderMetrics
      defaultExpanded={!isMobile}
      headerCanBeClicked
      rememberExpand="volatility-points"
      title={
        <TypographyTooltip
          variant="body1"
          sx={{ fontWeight: "bold" }}
          gutterBottom
        >
          Volatility Points
        </TypographyTooltip>
      }
      titleRight={
        <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
          <DateSelectionDialog
            endTime={config.endTime}
            onEndTimeChange={(endTime) =>
              updateConfig({
                endTime,
                range: "custom",
              })
            }
            onRangeChange={(range, timeWindow) =>
              updateConfig({
                range,
                startTime: timeWindow?.startTime,
                endTime: timeWindow?.endTime,
              })
            }
            range={config.range}
            startTime={config.startTime}
            onStartTimeChange={(startTime) =>
              updateConfig({
                startTime,
                range: "custom",
              })
            }
          />
        </Box>
      }
    >
      {(expanded) =>
        expanded && (
          <Box>
            <Button
              disabled={loading || resettingVPointUsed}
              onClick={() => void onResetVPointUsed()}
              size="small"
              startIcon={<RestartAltIcon fontSize="small" />}
              sx={{
                display: { xs: "none", sm: "inline-flex" },
              }}
              variant="outlined"
            >
              {resettingVPointUsed ? "Resetting..." : "Reset used vPoints"}
            </Button>
            {data ? (
              <MultiLineTimelined
                names={data.names}
                onVisibleTimeRangeChange={onVolatilityVisibleRange}
                series={data.series}
              />
            ) : (
              <Typography color="text.secondary" variant="body2">
                Volatility points are loading...
              </Typography>
            )}
            <BlackSwanTimeline
              datasetEndTimeMs={config.endTime}
              datasetStartTimeMs={config.startTime}
              key={dashboardState?.activeMode}
              timeline={dashboardState?.blackSwanTimeline}
              unavailableMessage="Recording Black Swan history; waiting for the next evaluation."
              visibleRange={volatilityRange}
            />
          </Box>
        )
      }
    </HeaderMetrics>
  );
}
