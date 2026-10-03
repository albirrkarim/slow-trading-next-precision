"use client";

import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";

import { getExchangeAccountTypeLabel } from "./utils";

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
              justifyContent: "space-between",
              minHeight: 44,
              textAlign: "left",
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
              {account.description && (
                <Typography
                  component="span"
                  display="block"
                  noWrap
                  sx={{
                    color: selected
                      ? "primary.contrastText"
                      : "text.secondary",
                    opacity: selected ? 0.82 : 1,
                  }}
                  variant="caption"
                >
                  {account.description}
                </Typography>
              )}
            </Box>
            <Chip
              color={account.enabled ? "success" : "default"}
              label={account.enabled ? "Entries on" : "Entries off"}
              size="small"
              variant={selected ? "filled" : "outlined"}
            />
          </Button>
        );
      })}
    </Stack>
  );
}
