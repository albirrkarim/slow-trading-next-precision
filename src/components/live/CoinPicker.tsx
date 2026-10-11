"use client";

import { Autocomplete, TextField } from "@mui/material";

import { normalizeCoin } from "./useDashboardHints";

/** Coin input with suggestions; any Binance base symbol can be typed. */
export default function CoinPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (coin: string) => void;
}) {
  return (
    <Autocomplete
      autoHighlight
      disableClearable
      freeSolo
      onChange={(_, next) => {
        const coin = normalizeCoin(String(next ?? ""));
        if (coin) onChange(coin);
      }}
      options={options}
      renderInput={(params) => <TextField {...params} label="Coin" size="small" />}
      size="small"
      sx={{ width: 140 }}
      value={value}
    />
  );
}
