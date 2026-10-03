"use client";

import {
  Alert,
  Box,
  Stack,
} from "@mui/material";
import type { BlackSwanConfig } from "@/lib/system/trading/black-swan";
import SettingsDialogSection from "../../Components/SettingsDialogSection";

import { Field } from "./Field";

export function BreadthSection({
  breadthUnderConfigured,
  config,
  nonBtcSymbolCount,
  update,
}: {
  breadthUnderConfigured: boolean;
  config: BlackSwanConfig;
  nonBtcSymbolCount: number;
  update: (blackSwan: BlackSwanConfig) => void;
}) {
  return (
    <SettingsDialogSection
      title="Altcoin breadth confirmation"
      description="After BTC reaches WATCH, the sentinel checks whether enough configured non-BTC symbols are falling together. A single altcoin crash cannot activate global protection."
    >
      <Stack spacing={2}>
        {breadthUnderConfigured && (
          <Alert severity="warning">
            Breadth confirmation needs{" "}
            {config.breadthConfirmation.minimumValidSymbols} valid non-BTC
            symbols, but only {nonBtcSymbolCount} are configured. The
            breadth CRISIS path cannot trigger with this configuration;
            BTC hard-trigger protection remains active. Lower the minimum
            or add symbols.
          </Alert>
        )}
        <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            lg: "repeat(4, 1fr)",
          },
        }}
      >
        <Field
          integer
          info="Closed-candle window used for each configured non-BTC symbol."
          label="Breadth Window (Minutes)"
          onChange={(value) =>
            update({
              ...config,
              breadthConfirmation: {
                ...config.breadthConfirmation,
                windowMinutes: value,
              },
            })
          }
          value={config.breadthConfirmation.windowMinutes}
        />
        <Field
          info="A valid altcoin counts as affected at or below this drawdown."
          label="Altcoin Drawdown (%)"
          onChange={(value) =>
            update({
              ...config,
              breadthConfirmation: {
                ...config.breadthConfirmation,
                altDrawdownPct: value,
              },
            })
          }
          value={config.breadthConfirmation.altDrawdownPct}
        />
        <Field
          info="Required affected share among configured symbols with fresh valid data."
          label="Affected Symbols (%)"
          onChange={(value) =>
            update({
              ...config,
              breadthConfirmation: {
                ...config.breadthConfirmation,
                affectedSymbolsPct: value,
              },
            })
          }
          value={config.breadthConfirmation.affectedSymbolsPct}
        />
        <Field
          integer
          info="Breadth cannot confirm CRISIS with fewer fresh symbols."
          label="Minimum Valid Symbols"
          onChange={(value) =>
            update({
              ...config,
              breadthConfirmation: {
                ...config.breadthConfirmation,
                minimumValidSymbols: value,
              },
            })
          }
          value={config.breadthConfirmation.minimumValidSymbols}
        />
        </Box>
      </Stack>
    </SettingsDialogSection>
  );
}
