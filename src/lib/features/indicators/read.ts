/**
 * Readers over `coins[s].ind` with fallbacks to the shapes snapshots were
 * recorded in before dynamic indicators existed. Every consumer (gates,
 * previews, dataset filters) reads through here instead of the raw path.
 */

import type { CoinFeatures } from "../types";
import { GATE_VWAP_ID } from "./constants";
import type { CoinEma, CoinSupertrend, CoinVwap } from "./types";

/**
 * VWAP reading for instance `id` (default: the gates' monthly `vwap`).
 * Falls back to the pre-indicator `coin.vwap` group, then to the flat
 * `vwap*` fields of the oldest snapshots.
 */
function vwap(
  coin: CoinFeatures | undefined,
  id: string = GATE_VWAP_ID,
): CoinVwap | undefined {
  const current = coin?.ind?.vwap?.[id];
  if (current) return current;
  if (id !== GATE_VWAP_ID) return undefined;
  const legacy = coin?.vwap as CoinVwap | number | undefined;
  if (typeof legacy === "number") {
    return {
      anchorT: coin?.vwapAnchorT,
      distancePct: coin?.vwapDistancePct,
      price: legacy,
      stdev: coin?.vwapStdev,
      stretchPct: coin?.vwapStretchPct,
    };
  }
  return legacy;
}

/** Supertrend reading for instance `id`. */
function supertrend(
  coin: CoinFeatures | undefined,
  id: string,
): CoinSupertrend | undefined {
  return coin?.ind?.supertrend?.[id];
}

/** EMA reading for instance `id`. */
function ema(coin: CoinFeatures | undefined, id: string): CoinEma | undefined {
  return coin?.ind?.ema?.[id];
}

const indicatorRead = { ema, supertrend, vwap } as const;

export default indicatorRead;
