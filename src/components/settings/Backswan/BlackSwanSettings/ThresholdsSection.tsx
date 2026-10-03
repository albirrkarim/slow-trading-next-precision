"use client";

import {
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from "@mui/material";
import type { BlackSwanConfig } from "@/lib/system/trading/black-swan";
import SettingsDialogSection from "../../Components/SettingsDialogSection";

import { Field } from "./Field";

export function ThresholdsSection({
  config,
  onResetThresholds,
  update,
}: {
  config: BlackSwanConfig;
  onResetThresholds: () => void;
  update: (blackSwan: BlackSwanConfig) => void;
}) {
  return (
    <SettingsDialogSection
      title="BTC warning and crisis thresholds"
      description="BTC is the primary trigger. Warning thresholds pause new risk; hard thresholds enter CRISIS immediately without waiting for altcoin confirmation."
    >
      <Stack spacing={2}>
        <Alert severity="info">
          Enter positive drawdown magnitudes: <strong>4</strong> means BTC
          has fallen <strong>-4%</strong> from the highest closed-candle
          close in that window.
        </Alert>

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            onClick={onResetThresholds}
            size="small"
            variant="outlined"
          >
            Reset detector thresholds
          </Button>
        </Box>

        <Box>
          <Typography fontWeight={700} sx={{ mb: 1 }} variant="body2">
            WATCH thresholds — either one pauses entries and averaging
          </Typography>
          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
            }}
          >
            <Field
              info="Enters WATCH when BTC reaches this 5-minute closed-candle drawdown."
              label="Warning 5m (%)"
              onChange={(value) =>
                update({
                  ...config,
                  btcWarning: {
                    ...config.btcWarning,
                    fiveMinuteDrawdownPct: value,
                  },
                })
              }
              value={config.btcWarning.fiveMinuteDrawdownPct}
            />
            <Field
              info="Enters WATCH when BTC reaches this 15-minute closed-candle drawdown."
              label="Warning 15m (%)"
              onChange={(value) =>
                update({
                  ...config,
                  btcWarning: {
                    ...config.btcWarning,
                    fifteenMinuteDrawdownPct: value,
                  },
                })
              }
              value={config.btcWarning.fifteenMinuteDrawdownPct}
            />
          </Box>
        </Box>

        <Box>
          <Typography fontWeight={700} sx={{ mb: 1 }} variant="body2">
            CRISIS thresholds — any one applies the emergency policy
          </Typography>
          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
                md: "repeat(3, 1fr)",
              },
            }}
          >
            <Field
              info="Enters CRISIS immediately; breadth confirmation is not required."
              label="Hard 5m (%)"
              onChange={(value) =>
                update({
                  ...config,
                  btcHardTrigger: {
                    ...config.btcHardTrigger,
                    fiveMinuteDrawdownPct: value,
                  },
                })
              }
              value={config.btcHardTrigger.fiveMinuteDrawdownPct}
            />
            <Field
              info="Enters CRISIS immediately; breadth confirmation is not required."
              label="Hard 15m (%)"
              onChange={(value) =>
                update({
                  ...config,
                  btcHardTrigger: {
                    ...config.btcHardTrigger,
                    fifteenMinuteDrawdownPct: value,
                  },
                })
              }
              value={config.btcHardTrigger.fifteenMinuteDrawdownPct}
            />
            <Field
              info="Longer-window direct CRISIS threshold."
              label="Hard 60m (%)"
              onChange={(value) =>
                update({
                  ...config,
                  btcHardTrigger: {
                    ...config.btcHardTrigger,
                    sixtyMinuteDrawdownPct: value,
                  },
                })
              }
              value={config.btcHardTrigger.sixtyMinuteDrawdownPct}
            />
          </Box>
        </Box>
      </Stack>
    </SettingsDialogSection>
  );
}
