"use client";

import { Autocomplete, TextField } from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";

/** Suggestions when the dashboard config is unavailable (signed out). */
const FALLBACK_COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "SUI", "HBAR", "XLM", "AVAX", "LINK"];

/** Normalizes typed input (`sol`, `SOLUSDT`, `sol_usdt`) to a base symbol. */
function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/_?USDT$/, "");
}

/**
 * Coin input: the dashboard's configured symbols (plus BTC) as suggestions
 * when signed in, a common-coins list otherwise; any Binance base symbol can
 * be typed.
 */
export default function CoinPicker({ value, onChange }: { value: string; onChange: (coin: string) => void }) {
  const [options, setOptions] = useState<string[]>(FALLBACK_COINS);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get<{ config?: { symbols?: string[] } }>(endpoints.system.state, { signal: controller.signal })
      .then((res) => {
        const symbols = res.data.config?.symbols ?? [];
        if (symbols.length > 0) setOptions([...new Set(["BTC", ...symbols.map(normalize)])]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <Autocomplete
      autoHighlight
      disableClearable
      freeSolo
      onChange={(_, next) => {
        const coin = normalize(String(next ?? ""));
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
