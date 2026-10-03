"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import type { BlackSwanConfig, BlackSwanState } from "@/lib/system/trading/black-swan";
import SettingsDialogSection from "../../Components/SettingsDialogSection";
import type { ConfigDraft, ConfigDraftSetter, DashboardState } from "../../settings-types";

import { STATUS_STEPS, statusColor } from "./config";
import { Field } from "./Field";

export function ProtectionSection({
  config,
  configDraft,
  currentState,
  dashboardState,
  onResetAll,
  setConfigDraft,
  update,
}: {
  config: BlackSwanConfig;
  configDraft: ConfigDraft;
  currentState: BlackSwanState;
  dashboardState: DashboardState;
  onResetAll: () => void;
  setConfigDraft: ConfigDraftSetter;
  update: (blackSwan: BlackSwanConfig) => void;
}) {
  return (
    <SettingsDialogSection
      title="Portfolio crash protection"
      description="A separate one-minute Risk Sentinel watches BTC first, confirms wider market stress when needed, and temporarily controls whether the portfolio may add risk."
    >
      <Stack spacing={2}>
        <Box
          sx={{
            alignItems: { xs: "flex-start", md: "center" },
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 2,
            justifyContent: "space-between",
          }}
        >
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enabled}
                  onChange={(event) =>
                    update({ ...config, enabled: event.target.checked })
                  }
                />
              }
              label={
                <Typography fontWeight={700}>
                  Black Swan Protection: {config.enabled ? "ON" : "OFF"}
                </Typography>
              }
              sx={{ m: 0 }}
            />
            <Stack
              alignItems="center"
              direction="row"
              flexWrap="wrap"
              gap={1}
              sx={{ mt: 0.75 }}
            >
              <Typography color="text.secondary" variant="body2">
                Current {dashboardState.activeMode} state
              </Typography>
              <Chip
                color={statusColor(currentState.status)}
                label={currentState.status}
                size="small"
              />
              <Chip
                label={currentState.reason}
                size="small"
                variant="outlined"
              />
            </Stack>
          </Box>

          <Button
            onClick={onResetAll}
            size="small"
            variant="outlined"
          >
            Reset all Black Swan settings
          </Button>
        </Box>

        <Alert severity={config.enabled ? "success" : "warning"}>
          {config.enabled
            ? "Protection is enabled. WATCH, CRISIS, and RECOVERY block every new entry and averaging action; risk-reducing exits continue."
            : "Protection is disabled. The Risk Sentinel will not block entries, pause averaging, or apply emergency exits during a market-wide crash."}
        </Alert>

        <Box
          aria-label="Black Swan protection state flow"
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(4, minmax(0, 1fr))",
            },
          }}
        >
          {STATUS_STEPS.map((step, index) => (
            <Box
              key={step.status}
              sx={(theme) => ({
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1.5,
                p: 1.5,
              })}
            >
              <Stack alignItems="center" direction="row" gap={1}>
                <Typography color="text.secondary" variant="caption">
                  {index + 1}
                </Typography>
                <Chip
                  color={step.color}
                  label={step.status}
                  size="small"
                  variant={
                    step.status === currentState.status
                      ? "filled"
                      : "outlined"
                  }
                />
              </Stack>
              <Typography
                color="text.secondary"
                sx={{ mt: 1 }}
                variant="body2"
              >
                {step.description}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
          }}
        >
          <Field
            integer
            info="Independent Risk Sentinel cadence. One minute is recommended."
            label="Risk Sentinel Interval (Minutes)"
            onChange={(value) =>
              setConfigDraft((previous) =>
                previous
                  ? {
                      ...previous,
                      runtime: {
                        ...previous.runtime,
                        blackSwanStageIntervalMinutes: value,
                      },
                    }
                  : previous,
              )
            }
            value={configDraft.runtime.blackSwanStageIntervalMinutes ?? 1}
          />
          <Field
            integer
            info="BTC evidence older than this enters fail-closed WATCH, but stale data never causes a blind emergency exit."
            label="Maximum Data Age (Minutes)"
            onChange={(value) =>
              update({ ...config, maxDataAgeMinutes: value })
            }
            value={config.maxDataAgeMinutes}
          />
        </Box>
      </Stack>
    </SettingsDialogSection>
  );
}
