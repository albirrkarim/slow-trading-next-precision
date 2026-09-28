import type { Marker } from "./chart-markers";

import { common, orange, purple } from "@mui/material/colors";
import type { UTCTimestamp } from "lightweight-charts";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import format from "@/lib/system/utils/format";

type TradeMarkerPosition = Pick<
  RuntimeHistoryPosition,
  "closed" | "opened" | "pnl" | "symbol"
> & { strategy?: RuntimeHistoryPosition["strategy"] };

/**
 * Builds entry and exit chart markers for trade rows matching one symbol.
 * `roleOf` optionally resolves a strategy-owned leg role per trade — defined
 * roles prefix the label (`MAIN leg ENTRY …`, `COUNTER leg EXIT …`).
 */
export function buildTradeMarkersFromHistory(
  history: TradeMarkerPosition[],
  symbol: string,
  roleOf?: (trade: TradeMarkerPosition) => string | undefined,
): Marker[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const markers: Marker[] = [];

  history.forEach((trade) => {
    if (trade.symbol?.trim().toUpperCase() !== normalizedSymbol) {
      return;
    }

    const role = roleOf?.(trade)?.trim();
    const rolePrefix = role ? `${role} leg ` : "";

    if (Number.isFinite(trade.opened.t)) {
      markers.push({
        color: common.black,
        position: "belowBar",
        shape: "arrowUp",
        text: `${rolePrefix}ENTRY ${trade.opened.vPoint.id}`,
        time: Math.floor(trade.opened.t / 1000) as UTCTimestamp,
      });
    }

    if (Number.isFinite(trade.closed?.t)) {
      markers.push({
        color:
          (trade.pnl.netPct ?? 0) >= 0 ? purple[500] : orange[500],
        position: "aboveBar",
        shape: "arrowDown",
        text: trade.closed!.vPoint?.id
          ? `${rolePrefix}EXIT ${trade.closed!.vPoint.id} paired with ${format.vPointForLog(trade.opened.vPoint)}`
          : `${rolePrefix}EXIT paired with ${format.vPointForLog(trade.opened.vPoint)}`,
        time: Math.floor(trade.closed!.t / 1000) as UTCTimestamp,
      });
    }
  });

  return markers.sort((a, b) => Number(a.time) - Number(b.time));
}
