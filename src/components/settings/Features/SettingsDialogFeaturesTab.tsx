"use client";

import AddIcon from "@mui/icons-material/Add";
import { Alert, Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { useState } from "react";

import indicators, {
  GATE_VWAP_ID,
  MAX_INDICATORS,
  type FeatureIndicatorConfig,
  type FeatureIndicatorType,
} from "@/lib/features/indicators";

import SettingsGroup from "../Components/SettingsGroup";
import type { ConfigDraft, ConfigDraftSetter } from "../settings-types";
import FeatureIndicatorCard from "./FeatureIndicatorCard";

function AddIndicatorButton({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: FeatureIndicatorType) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        size="small"
        startIcon={<AddIcon />}
        variant="outlined"
      >
        Add indicator
      </Button>
      <Menu anchorEl={anchorEl} onClose={() => setAnchorEl(null)} open={Boolean(anchorEl)}>
        {indicators.registry.types.map((type) => (
          <MenuItem
            key={type}
            onClick={() => {
              onAdd(type);
              setAnchorEl(null);
            }}
          >
            {indicators.registry.definitions[type].label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * Dynamic indicator instances (`management.indicators`) computed as entry
 * features in backtest, sandbox, and live.
 */
export default function SettingsDialogFeaturesTab({
  configDraft,
  setConfigDraft,
}: {
  configDraft: ConfigDraft;
  setConfigDraft: ConfigDraftSetter;
}) {
  const list = indicators.config.normalize(configDraft.management.indicators);

  const setList = (
    update: (current: FeatureIndicatorConfig[]) => FeatureIndicatorConfig[],
  ) =>
    setConfigDraft((prev) =>
      prev
        ? {
            ...prev,
            management: {
              ...prev.management,
              indicators: update(indicators.config.normalize(prev.management.indicators)),
            },
          }
        : prev,
    );

  return (
    <Stack gap={2}>
      <SettingsGroup
        description="Each instance is computed for every tracked coin, stored at coins[symbol].ind.<type>.<id>, and frozen into the position's entry features. Larger intervals are built from 1m/5m candles on UTC boundaries."
        info="Renaming an id only changes where readings are stored; changing params restarts that instance's warm-up (up to ~55 days of history)."
        title="Indicators"
      >
        <Stack gap={1.5}>
          {!indicators.config.hasGateVwap(list) && (
            <Alert severity="warning">
              Feature gates v2–v5 read the monthly VWAP from id <code>{GATE_VWAP_ID}</code> (VWAP,
              month anchor, enabled). Without it they reject entries for missing VWAP data.
            </Alert>
          )}
          {list.length === 0 && (
            <Typography color="text.secondary" variant="body2">
              No indicators configured.
            </Typography>
          )}
          {list.map((item, index) => (
            <FeatureIndicatorCard
              item={item}
              key={`${index}:${item.id}`}
              onChange={(patch) =>
                setList((current) =>
                  current.map((entry, i) =>
                    i === index ? ({ ...entry, ...patch } as FeatureIndicatorConfig) : entry,
                  ),
                )
              }
              onDuplicate={() =>
                setList((current) => {
                  const copy = indicators.config.create(item.type, current);
                  return [
                    ...current.slice(0, index + 1),
                    { ...item, id: copy.id },
                    ...current.slice(index + 1),
                  ];
                })
              }
              onRemove={() => setList((current) => current.filter((_, i) => i !== index))}
              takenIds={new Set(list.filter((_, i) => i !== index).map((entry) => entry.id))}
            />
          ))}
          <div>
            <AddIndicatorButton
              disabled={list.length >= MAX_INDICATORS}
              onAdd={(type) =>
                setList((current) => [...current, indicators.config.create(type, current)])
              }
            />
          </div>
        </Stack>
      </SettingsGroup>
    </Stack>
  );
}
