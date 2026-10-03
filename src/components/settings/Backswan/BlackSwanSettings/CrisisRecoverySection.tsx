"use client";

import {
  Alert,
  Box,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import type { BlackSwanConfig } from "@/lib/system/trading/black-swan";
import SettingsDialogSection from "../../Components/SettingsDialogSection";
import SettingsInfoField from "../../Components/SettingsInfoField";

import { EXIT_POLICY_DETAILS } from "./config";
import { Field } from "./Field";

export function CrisisRecoverySection({
  config,
  update,
}: {
  config: BlackSwanConfig;
  update: (blackSwan: BlackSwanConfig) => void;
}) {
  const exitPolicyDetails = EXIT_POLICY_DETAILS[config.exitPolicy];

  return (
    <SettingsDialogSection
      title="Crisis response and recovery"
      description="Choose what happens to existing positions after CRISIS is confirmed, and how cautiously the system resumes trading."
    >
      <Stack spacing={2}>
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" },
          }}
        >
          <SettingsInfoField
            fullWidth
            info="Controls which existing positions are closed during a confirmed downward market crisis."
            label="Emergency Exit Policy"
            onChange={(event) =>
              update({
                ...config,
                exitPolicy: event.target
                  .value as BlackSwanConfig["exitPolicy"],
              })
            }
            select
            size="small"
            value={config.exitPolicy}
          >
            <MenuItem value="FREEZE_ONLY">
              Freeze only — do not emergency close
            </MenuItem>
            <MenuItem value="CLOSE_ADVERSE">
              Close adverse — preserve SHORT hedges
            </MenuItem>
            <MenuItem value="FLATTEN_ALL">
              Flatten all — close every position
            </MenuItem>
          </SettingsInfoField>
          <Field
            integer
            info="Entries and averaging remain blocked for this continuous healthy period after the warning or crisis clears."
            label="Recovery Cooldown (Minutes)"
            onChange={(value) =>
              update({ ...config, recoveryCooldownMinutes: value })
            }
            value={config.recoveryCooldownMinutes}
          />
        </Box>

        <Alert severity={exitPolicyDetails.severity}>
          {exitPolicyDetails.text}
        </Alert>

        <FormControlLabel
          control={
            <Switch
              checked={config.requireManualLiveRecovery}
              onChange={(event) =>
                update({
                  ...config,
                  requireManualLiveRecovery: event.target.checked,
                })
              }
            />
          }
          label="Require manual acknowledgement before LIVE trading resumes"
        />
        <Typography color="text.secondary" variant="caption">
          Sandbox may recover automatically after cooldown. When enabled
          for live mode, an operator must also acknowledge RECOVERY from
          the dashboard banner.
        </Typography>
      </Stack>
    </SettingsDialogSection>
  );
}
