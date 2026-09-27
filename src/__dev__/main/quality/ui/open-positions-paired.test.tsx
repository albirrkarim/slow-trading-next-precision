/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "@/components/LiveDashboard/Feature/OpenPositionItem",
  () => ({
    default: (props: { position: { symbol: string } }) => (
      <div data-testid="open-position">{props.position.symbol}</div>
    ),
  }),
);

vi.mock(
  "@/components/LiveDashboard/Feature/use-entry-diagnostics",
  () => ({
    useEntryDiagnostics: () => ({
      error: "",
      loading: false,
      refresh: vi.fn(async () => undefined),
      snapshot: undefined,
    }),
  }),
);

import OpenPositions from "@/components/LiveDashboard/Feature/OpenPositions";
import type { Position } from "@/lib/system/trading";

function position(overrides: Partial<Position> = {}): Position {
  return {
    account: "acc",
    direction: "LONG",
    exposure: { marginUsdt: 10 },
    opened: { price: 1, t: 100, vPoint: { id: "A" } },
    pnl: { netPct: 0, netUsdt: 0 },
    symbol: "SUI",
    ...overrides,
  } as unknown as Position;
}

function pairedLeg(
  role: "MAIN" | "COUNTER",
  overrides: Partial<Position> = {},
): Position {
  return position({
    ...overrides,
    strategy: {
      averaging: {},
      entry: {},
      logic: { entryLegs: "BOTH", pairId: "acc:SUI:A", role },
    },
  } as unknown as Position);
}

function baseProps() {
  return {
    accounts: ["acc"],
    availableTags: [] as string[],
    coinDescriptions: {} as Record<string, string>,
    coinTags: {} as Record<string, string[]>,
    config: {
      openDirection: "BOTH",
      strategy: "both",
      symbols: ["SUI"],
    } as never,
    exchangeType: "binance" as never,
    mode: "sandbox" as never,
    onCoinDescriptionChange: vi.fn(),
    onCoinTagsChange: vi.fn(),
    spendableQuoteAsset: 1000,
    tagColors: {} as Record<string, string>,
    tagDescriptions: {} as Record<string, string>,
    volatilityMap: {},
    volume24hBySymbol: {},
  };
}

describe("OpenPositions — paired board", () => {
  it("renders the surviving leg plus the closed-leg snapshot chip", () => {
    const surviving = pairedLeg("COUNTER", { direction: "SHORT" });
    render(
      <OpenPositions
        {...baseProps()}
        positions={[surviving as never]}
        strategyState={{
          closed: {
            "acc:SUI:A": {
              account: "acc",
              closed: { price: 0.9, reason: "STOP_LOSS", t: 200 },
              direction: "LONG",
              marginUsdt: 10,
              opened: { price: 1, t: 100 },
              pnl: { pct: -10, usdt: -5 },
              role: "MAIN",
              symbol: "SUI",
            },
          },
          v: "both",
        }}
      />,
    );

    // One open leg renders through the shared position item.
    expect(screen.getAllByTestId("open-position")).toHaveLength(1);
    // The closed MAIN slot stays visible as a compact Closed card.
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("STOP_LOSS")).toBeTruthy();
  });

  it("keeps the flat list for the default strategy", () => {
    const props = baseProps();
    (props.config as { strategy?: string }).strategy = undefined;
    render(
      <OpenPositions
        {...props}
        positions={[
          position() as never,
          position({ direction: "SHORT" }) as never,
        ]}
      />,
    );

    expect(screen.getAllByTestId("open-position")).toHaveLength(2);
    expect(screen.queryByText("Closed")).toBeNull();
  });
});
