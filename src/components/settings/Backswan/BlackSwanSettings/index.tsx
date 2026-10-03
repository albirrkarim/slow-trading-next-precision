"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
} from "@mui/material";
import blackSwanModel, {type BlackSwanConfig} from "@/lib/system/trading/black-swan";
import { normalizeDatasetSymbol } from "@/lib/dev/klines";
import BlackSwanSavingsPreview from "../BlackSwanSavingsPreview";
import type { ConfigDraft, ConfigDraftSetter, DashboardState } from "../../settings-types";

import { BreadthSection } from "./BreadthSection";
import { CrisisRecoverySection } from "./CrisisRecoverySection";
import { ProtectionSection } from "./ProtectionSection";
import { ThresholdsSection } from "./ThresholdsSection";

export default function BlackSwanSettings({
  configDraft,
  dashboardState,
  selectedAccountSlug,
  setConfigDraft,
}: {
  configDraft: ConfigDraft;
  dashboardState: DashboardState;
  selectedAccountSlug?: string;
  setConfigDraft: ConfigDraftSetter;
}) {
  const update = (blackSwan: BlackSwanConfig) =>
    setConfigDraft((previous) =>
      previous
        ? {
            ...previous,
            management: { ...previous.management, blackSwan },
          }
        : previous,
    );
  const config = blackSwanModel.config.normalize(configDraft.management.blackSwan);
  const currentState = blackSwanModel.state.normalize(dashboardState.blackSwan);
  const nonBtcSymbolCount = new Set(
    (configDraft.management.symbols ?? [])
      .map(normalizeDatasetSymbol)
      .filter((symbol) => symbol && symbol !== "BTC"),
  ).size;
  const breadthUnderConfigured =
    config.enabled &&
    nonBtcSymbolCount < config.breadthConfirmation.minimumValidSymbols;
  const resetDetectorThresholds = () =>
    update({
      ...config,
      btcWarning: { ...blackSwanModel.config.defaults.btcWarning },
      btcHardTrigger: { ...blackSwanModel.config.defaults.btcHardTrigger },
      breadthConfirmation: {
        ...blackSwanModel.config.defaults.breadthConfirmation,
      },
    });
  const resetAll = () =>
    setConfigDraft((previous) =>
      previous
        ? {
            ...previous,
            management: {
              ...previous.management,
              blackSwan: {
                ...blackSwanModel.config.defaults,
                btcWarning: {
                  ...blackSwanModel.config.defaults.btcWarning,
                },
                btcHardTrigger: {
                  ...blackSwanModel.config.defaults.btcHardTrigger,
                },
                breadthConfirmation: {
                  ...blackSwanModel.config.defaults.breadthConfirmation,
                },
              },
            },
            runtime: {
              ...previous.runtime,
              blackSwanStageIntervalMinutes: 1,
            },
          }
        : previous,
    );
  // PROD:BLACK_SWAN_SAVINGS_PREVIEW_RESOURCE_GUARD
  const [showSavingsPreview, setShowSavingsPreview] = useState(false);

  return (
    <Grid alignItems="flex-start" container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Box sx={{ minWidth: 0 }}>
          <ProtectionSection
            config={config}
            configDraft={configDraft}
            currentState={currentState}
            dashboardState={dashboardState}
            onResetAll={resetAll}
            setConfigDraft={setConfigDraft}
            update={update}
          />

          <CrisisRecoverySection config={config} update={update} />

          <ThresholdsSection
            config={config}
            onResetThresholds={resetDetectorThresholds}
            update={update}
          />

          <BreadthSection
            breadthUnderConfigured={breadthUnderConfigured}
            config={config}
            nonBtcSymbolCount={nonBtcSymbolCount}
            update={update}
          />
        </Box>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={1.5}>
          <FormControlLabel
            control={
              <Switch
                checked={showSavingsPreview}
                onChange={(event) =>
                  setShowSavingsPreview(event.target.checked)
                }
              />
            }
            label="Load Black Swan live preview"
          />
          {showSavingsPreview ? (
            <BlackSwanSavingsPreview
              configDraft={configDraft}
              dashboardState={dashboardState}
              selectedAccountSlug={selectedAccountSlug}
            />
          ) : (
            <Alert severity="info">
              The historical replay is off. Enable it only when you want to
              run the resource-intensive Black Swan comparison.
            </Alert>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}
