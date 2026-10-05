/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/components/dashboard/positions/OpenPositionItem",
  () => ({
    default: (props: { position: { symbol: string } }) => (
      <div data-testid="open-position">{props.position.symbol}</div>
    ),
  }),
);

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  useEntryDiagnostics: vi.fn(),
}));

vi.mock(
  "@/components/dashboard/state/use-entry-diagnostics",
  () => ({
    useEntryDiagnostics: mocks.useEntryDiagnostics,
  }),
);

import OpenPositions from "@/components/dashboard/positions/OpenPositions";
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
      entryLegs: "BOTH",
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

function streakProps(overrides: Record<string, unknown> = {}) {
  const props = baseProps();
  (props.config as { strategy?: string }).strategy = "streak";
  return {
    ...props,
    positions: [] as never[],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useEntryDiagnostics.mockReturnValue({
    error: "",
    loading: false,
    refresh: mocks.refresh,
    snapshot: undefined,
  });
});

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

describe("OpenPositions — streak empty-row diagnostics", () => {
  it("shows the per-account/symbol diagnostics reason on both empty roles", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "",
      loading: false,
      refresh: mocks.refresh,
      snapshot: {
        accounts: [
          {
            account: { name: "Main", slug: "acc" },
            diagnostics: [
              {
                code: "NO_CONFIRMED_VPOINT",
                reason:
                  "No confirmed volatility point available for SUI; " +
                  "waiting for a signal.",
                status: "blocked",
                symbol: "SUI",
              },
            ],
          },
        ],
        generatedAt: 1,
        sharedGuards: [],
      },
    });

    render(<OpenPositions {...streakProps()} />);

    expect(
      screen.getAllByText(
        "No confirmed volatility point available for SUI; waiting for a signal.",
      ),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/No open pair — waiting for a fresh pair/),
    ).toBeNull();
  });

  it("shows a checking placeholder while the snapshot has not arrived", () => {
    render(<OpenPositions {...streakProps()} />);

    expect(
      screen.getAllByText("Checking entry decisions…"),
    ).toHaveLength(2);
  });

  it("shows the fetch error instead of a stale snapshot's reasons", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "Binance cooldown",
      loading: false,
      refresh: mocks.refresh,
      snapshot: {
        accounts: [
          {
            account: { name: "Main", slug: "acc" },
            diagnostics: [
              {
                code: "STALE",
                reason: "stale reason",
                status: "blocked",
                symbol: "SUI",
              },
            ],
          },
        ],
        generatedAt: 1,
        sharedGuards: [],
      },
    });

    render(<OpenPositions {...streakProps()} />);

    expect(
      screen.getAllByText("Entry decisions unavailable: Binance cooldown"),
    ).toHaveLength(2);
    expect(screen.queryByText("stale reason")).toBeNull();
  });

  it("refreshes diagnostics when a new capture-entry run lands", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "",
      loading: false,
      refresh: mocks.refresh,
      snapshot: { accounts: [], generatedAt: 1, sharedGuards: [] },
    });
    const props = streakProps({ captureEntryRanAt: 100 });
    const { rerender } = render(<OpenPositions {...props} />);

    expect(mocks.refresh).not.toHaveBeenCalled();

    rerender(<OpenPositions {...props} captureEntryRanAt={200} />);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender(<OpenPositions {...props} captureEntryRanAt={200} />);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit unavailable reason when the snapshot lacks the row", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "",
      loading: false,
      refresh: mocks.refresh,
      snapshot: { accounts: [], generatedAt: 1, sharedGuards: [] },
    });

    render(<OpenPositions {...streakProps()} />);

    expect(
      screen.getAllByText("No entry diagnostic available for acc:SUI."),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/No open pair — waiting for a fresh pair/),
    ).toBeNull();
  });

  it("routes each account+symbol reason to its own row without cross-talk", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "",
      loading: false,
      refresh: mocks.refresh,
      snapshot: {
        accounts: [
          {
            account: { name: "First", slug: "acc" },
            diagnostics: [
              {
                code: "ENTRY_LEVEL_BELOW_MINIMUM",
                reason: "acc SUI level 1 below min 3",
                status: "blocked",
                symbol: "SUI",
              },
              {
                code: "NO_CONFIRMED_VPOINT",
                reason: "acc DOGE has no point",
                status: "blocked",
                symbol: "DOGE",
              },
            ],
          },
          {
            account: { name: "Second", slug: "two" },
            diagnostics: [
              {
                code: "ENTRY_LEVEL_BELOW_MINIMUM",
                reason: "two SUI level 0 below min 3",
                status: "blocked",
                symbol: "SUI",
              },
              {
                code: "NO_CONFIRMED_VPOINT",
                reason: "two DOGE has no point",
                status: "blocked",
                symbol: "DOGE",
              },
            ],
          },
        ],
        generatedAt: 1,
        sharedGuards: [],
      },
    });

    render(
      <OpenPositions
        {...streakProps({
          accounts: ["acc", "two"],
          config: {
            entryLegs: "BOTH",
            strategy: "streak",
            symbols: ["SUI", "DOGE"],
          } as never,
          entryLegs: { acc: "BOTH", two: "MAIN" },
        })}
      />,
    );

    expect(
      screen.getAllByText("acc SUI level 1 below min 3"),
    ).toHaveLength(2);
    expect(screen.getAllByText("acc DOGE has no point")).toHaveLength(2);
    expect(
      screen.getAllByText("two SUI level 0 below min 3"),
    ).toHaveLength(1);
    expect(screen.getAllByText("two DOGE has no point")).toHaveLength(1);
    expect(
      screen.getAllByText("COUNTER disabled (Entry Legs: MAIN)."),
    ).toHaveLength(2);
  });

  it("keeps the paired board when only a one-way streak account is selected", () => {
    mocks.useEntryDiagnostics.mockReturnValue({
      error: "",
      loading: false,
      refresh: mocks.refresh,
      snapshot: {
        accounts: [
          {
            account: { name: "Second", slug: "two" },
            diagnostics: [
              {
                code: "ENTRY_LEVEL_BELOW_MINIMUM",
                reason: "two SUI level 0 below min 3",
                status: "blocked",
                symbol: "SUI",
              },
            ],
          },
        ],
        generatedAt: 1,
        sharedGuards: [],
      },
    });

    render(
      <OpenPositions
        {...streakProps({
          accounts: ["two"],
          config: {
            entryLegs: "MAIN",
            strategy: "streak",
            symbols: ["SUI"],
          } as never,
          entryLegs: { two: "MAIN" },
        })}
      />,
    );

    expect(
      screen.getAllByText("two SUI level 0 below min 3"),
    ).toHaveLength(1);
    expect(
      screen.getAllByText("COUNTER disabled (Entry Legs: MAIN)."),
    ).toHaveLength(1);
    expect(
      screen.queryByText(/No open pair — waiting for a fresh pair/),
    ).toBeNull();
  });

  it("renders an empty streak row's net as a muted $0.00", () => {
    render(<OpenPositions {...streakProps()} />);

    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.queryByText("+$0.00")).toBeNull();
  });

  it("keeps the signed USDT net for a streak row with an open leg", () => {
    render(
      <OpenPositions
        {...streakProps()}
        positions={[
          pairedLeg("MAIN", {
            pnl: { netPct: -1, netUsdt: -0.92 },
          }) as never,
        ]}
        strategyState={{ v: "streak" }}
      />,
    );

    expect(screen.getByText("-$0.92")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
