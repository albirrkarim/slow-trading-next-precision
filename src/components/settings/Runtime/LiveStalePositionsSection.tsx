"use client";

import { useState } from "react";

import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import SearchIcon from "@mui/icons-material/Search";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import axios from "axios";

import { endpoints } from "@/components/endpoints";
import type { StaleLivePosition, StaleLiveScan } from "@/lib/production";

import SettingsDialogSection from "../Components/SettingsDialogSection";
import type { ConfigDraft } from "../settings-types";

// PROD:SYNC_ENTRY_POSITION_FROM_EXCHANGE

interface AccountCheck {
  busy: "scan" | "clean" | null;
  error: string | null;
  removed: StaleLivePosition[] | null;
  scan: StaleLiveScan | null;
}

const idle: AccountCheck = { busy: null, error: null, removed: null, scan: null };

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
  }

  return error instanceof Error ? error.message : "Request failed.";
}

function describe(position: StaleLivePosition): string {
  return `${position.symbol} ${position.direction} · margin ${position.marginUsdt.toFixed(2)} USDT · opened ${new Date(position.openedAt).toLocaleString()}`;
}

export default function LiveStalePositionsSection({
  accounts,
}: {
  accounts: ConfigDraft["accounts"];
}) {
  const [checks, setChecks] = useState<Record<string, AccountCheck>>({});
  const update = (slug: string, patch: Partial<AccountCheck>) =>
    setChecks((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? idle), ...patch } }));

  const scan = async (slug: string) => {
    update(slug, { busy: "scan", error: null, removed: null });
    try {
      const { data } = await axios.post<{ scan: StaleLiveScan }>(
        endpoints.system.positions.staleLive,
        { account: slug, action: "scan" },
      );
      update(slug, { busy: null, scan: data.scan });
    } catch (error) {
      update(slug, { busy: null, error: errorMessage(error) });
    }
  };

  const clean = async (slug: string, name: string, stale: StaleLivePosition[]) => {
    if (
      !confirm(
        `Remove ${stale.length} stale live position${stale.length === 1 ? "" : "s"} from ${name}?\n\n` +
          `${stale.map(describe).join("\n")}\n\n` +
          "Binance no longer holds them. Precision re-checks Binance first and records no trade history for them.",
      )
    ) {
      return;
    }
    update(slug, { busy: "clean", error: null });
    try {
      const { data } = await axios.post<{ removed: StaleLivePosition[] }>(
        endpoints.system.positions.staleLive,
        { account: slug, action: "clean", keys: stale.map((position) => position.key) },
      );
      update(slug, { busy: null, removed: data.removed, scan: null });
    } catch (error) {
      update(slug, { busy: null, error: errorMessage(error) });
    }
  };

  return (
    <SettingsDialogSection
      title="Live Positions"
      description="Finds live positions Precision still stores but the exchange no longer holds, for example ones closed outside Precision, and removes them so their margin stops counting as locked balance. Positions open on the exchange are never touched."
    >
      <Stack spacing={1.5}>
        {accounts.map((account) => {
          const check = checks[account.slug] ?? idle;
          const stale = check.scan?.stale ?? [];
          return (
            <Box
              key={account.slug}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, px: 1.5, py: 1 }}
            >
              <Stack alignItems="center" direction="row" flexWrap="wrap" spacing={1.5} useFlexGap>
                <Typography fontWeight={700} noWrap sx={{ flexGrow: 1, minWidth: 0 }} variant="body2">
                  {account.name}
                  <Typography color="text.secondary" component="span" sx={{ ml: 0.75 }} variant="caption">
                    {account.slug}
                  </Typography>
                </Typography>
                <Button
                  disabled={check.busy !== null}
                  onClick={() => {
                    void scan(account.slug);
                  }}
                  size="small"
                  startIcon={check.busy === "scan" ? <CircularProgress size={14} /> : <SearchIcon />}
                  variant="outlined"
                >
                  {check.busy === "scan" ? "Checking..." : "Check"}
                </Button>
                {stale.length > 0 && (
                  <Button
                    color="warning"
                    disabled={check.busy !== null}
                    onClick={() => {
                      void clean(account.slug, account.name, stale);
                    }}
                    size="small"
                    startIcon={check.busy === "clean" ? <CircularProgress size={14} /> : <CleaningServicesIcon />}
                    variant="contained"
                  >
                    {check.busy === "clean" ? "Removing..." : `Remove ${stale.length} stale`}
                  </Button>
                )}
              </Stack>

              {check.scan && stale.length === 0 && (
                <Typography color="text.secondary" sx={{ display: "block", mt: 0.75 }} variant="caption">
                  No stale positions: {check.scan.storedOpen} stored, {check.scan.exchangeOpen} open on the exchange.
                </Typography>
              )}
              {stale.length > 0 && (
                <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                  {stale.map((position) => (
                    <Typography color="warning.main" key={position.key} variant="caption">
                      {describe(position)}
                    </Typography>
                  ))}
                </Stack>
              )}
              {check.removed && (
                <Typography
                  color={check.removed.length === 0 ? "warning.main" : "success.main"}
                  sx={{ display: "block", mt: 0.75 }}
                  variant="caption"
                >
                  {check.removed.length === 0
                    ? "Nothing was removed: on a fresh check the exchange no longer showed them as stale. Run Check again."
                    : `Removed ${check.removed.length} stale position${check.removed.length === 1 ? "" : "s"}: ${check.removed.map((position) => position.symbol).join(", ")}. The dashboard balance updates on its next refresh.`}
                </Typography>
              )}
              {check.error && (
                <Typography color="error" sx={{ display: "block", mt: 0.75 }} variant="caption">
                  {check.error}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </SettingsDialogSection>
  );
}
