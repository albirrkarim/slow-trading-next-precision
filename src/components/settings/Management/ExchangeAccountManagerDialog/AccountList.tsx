"use client";

import {
  Box,
  Button,
  Stack,
  Typography,
} from "@mui/material";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";

import { getExchangeAccountTypeLabel, isInAccounting } from "./utils";

/** A small coloured dot with a label: green when on, grey when off. */
function StatusDot({
  label,
  on,
  selected,
}: {
  label: string;
  on: boolean;
  selected: boolean;
}) {
  return (
    <Stack alignItems="center" direction="row" spacing={0.5}>
      <Box
        sx={{
          bgcolor: on ? "success.main" : selected ? "primary.contrastText" : "text.disabled",
          borderRadius: "50%",
          flexShrink: 0,
          height: 8,
          opacity: !on && selected ? 0.5 : 1,
          width: 8,
        }}
      />
      <Typography
        component="span"
        noWrap
        sx={{ color: selected ? "primary.contrastText" : on ? "text.primary" : "text.secondary" }}
        variant="caption"
      >
        {label}
      </Typography>
    </Stack>
  );
}

export function AccountList({
  accounts,
  editingSlug,
  onSelect,
}: {
  accounts: RuntimeAccountConfig[];
  editingSlug: string | undefined;
  onSelect: (slug: string) => void;
}) {
  return (
    <Stack gap={1}>
      {accounts.map((account) => {
        const selected = account.slug === editingSlug;
        return (
          <Button
            key={account.slug}
            variant={selected ? "contained" : "outlined"}
            color={selected ? "primary" : "inherit"}
            onClick={() => onSelect(account.slug)}
            sx={{
              justifyContent: "flex-start",
              minHeight: 44,
              textAlign: "left",
              textTransform: "none",
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component="span"
                display="block"
                fontWeight={700}
                noWrap
                variant="body2"
              >
                {account.name || account.slug}
              </Typography>
              <Typography
                component="span"
                display="block"
                noWrap
                sx={{
                  color: selected
                    ? "primary.contrastText"
                    : "text.secondary",
                }}
                variant="caption"
              >
                {getExchangeAccountTypeLabel(account.type)}
                {` · ${account.futuresPositionMode === "HEDGE" ? "Hedge" : "One-way"}`}
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }}>
                <StatusDot
                  label={account.enabled ? "Entries on" : "Entries off"}
                  on={account.enabled}
                  selected={selected}
                />
                <StatusDot
                  label={isInAccounting(account) ? "In accounting" : "Not in accounting"}
                  on={isInAccounting(account)}
                  selected={selected}
                />
              </Stack>
              {account.description && (
                <Typography
                  component="span"
                  display="block"
                  noWrap
                  sx={{
                    color: selected
                      ? "primary.contrastText"
                      : "text.secondary",
                    mt: 0.25,
                    opacity: selected ? 0.82 : 1,
                  }}
                  variant="caption"
                >
                  {account.description}
                </Typography>
              )}
            </Box>
          </Button>
        );
      })}
    </Stack>
  );
}
