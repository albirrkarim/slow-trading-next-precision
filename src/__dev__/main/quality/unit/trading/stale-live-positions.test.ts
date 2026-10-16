import staleLivePositions from "@/lib/production/stale-positions";
import type { UnifiedPosition } from "@/lib/exchange/types";
import type { Position } from "@/lib/system/trading/types";

// PROD:SYNC_ENTRY_POSITION_FROM_EXCHANGE

function stored(symbol: string, direction: "LONG" | "SHORT", openedAt = 1_700_000_000_000): Position {
  return {
    account: "1",
    direction,
    exposure: { averageEntryPrice: 1, leverage: 5, marginUsdt: 14.95, notionalUsdt: 74.75, quantity: 10 },
    opened: { t: openedAt },
    strategy: { averaging: { reservedRemainingMarginUsdt: 2 } },
    symbol,
  } as unknown as Position;
}

function onExchange(symbol: string, side: "LONG" | "SHORT" | "NET", amount = 1): UnifiedPosition {
  return { amount, originalSymbol: symbol.replace("_", ""), side, symbol } as unknown as UnifiedPosition;
}

describe("stale live positions", () => {
  it("treats a stored position as stale only when the exchange holds nothing on that symbol and side", () => {
    const positions = [stored("SOL_USDT", "LONG"), stored("ETH_USDT", "SHORT"), stored("XRP_USDT", "LONG")];
    const exchange = [onExchange("ETH_USDT", "SHORT"), onExchange("XRP_USDT", "SHORT")];

    expect(staleLivePositions.findStale(positions, exchange).map((position) => position.symbol)).toEqual(["SOL_USDT", "XRP_USDT"]);
  });

  it("never marks a position stale while a one-way (NET) position exists on the symbol", () => {
    expect(staleLivePositions.findStale([stored("SOL_USDT", "LONG")], [onExchange("SOLUSDT", "NET")])).toEqual([]);
  });

  it("ignores zero-size exchange rows and already closed stored positions", () => {
    const closed = { ...stored("BNB_USDT", "LONG"), closed: { t: 1 } } as unknown as Position;

    expect(staleLivePositions.findStale([stored("SOL_USDT", "LONG"), closed], [onExchange("SOL_USDT", "LONG", 0)]).map((position) => position.symbol)).toEqual(["SOL_USDT"]);
  });

  it("keys positions by symbol, direction and open time", () => {
    expect(staleLivePositions.positionKey(stored("sol-usdt", "LONG", 42))).toBe("SOLUSDT|LONG|42");
  });
});
