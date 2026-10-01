/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BacktestTradeHistory, {
  filterBacktestTradeHistory,
} from "@/components/dev/backtest-precision/BacktestTradeHistory";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

import type { LazyArtifact } from "@/components/dev/backtest-precision/use-backtest-artifacts";

vi.mock("@/components/reports/TradesTableSection", () => ({
  TradesTableSection: ({ history }: { history: Position[] }) => (
    <div data-testid="backtest-history">
      {history.map((trade) => `${trade.account}:${trade.symbol}`).join(",")}
    </div>
  ),
}));

const day = (value: string) => new Date(`${value}T12:00:00`).getTime();

const positions = [
  {
    account: "acc-1",
    closed: { t: day("2024-03-12") },
    opened: { t: day("2024-03-10") },
    symbol: "BTC",
  },
  {
    account: "acc-2",
    closed: { t: day("2024-04-07") },
    opened: { t: day("2024-04-05") },
    symbol: "ETH",
  },
  {
    account: "acc-1",
    closed: { t: day("2024-06-22") },
    opened: { t: day("2024-06-20") },
    symbol: "SOL",
  },
  {
    account: "acc-2",
    closed: { t: day("2024-07-03") },
    opened: { t: day("2024-07-01") },
    symbol: "SUI",
  },
] as Position[];

const positionsArtifact = {
  data: positions,
  ensure: () => Promise.resolve(positions),
  loading: false,
} as LazyArtifact<Position[]>;

const vpointsArtifact = {
  data: {},
  ensure: () => Promise.resolve({}),
  loading: false,
} as LazyArtifact<Record<string, VolatilityPoint[]>>;

const renderSection = () =>
  render(
    <BacktestTradeHistory
      accounts={[
        { name: "Main", slug: "acc-1" },
        { name: "Alt", slug: "acc-2" },
      ]}
      closedCount={positions.length}
      exchangeType="binance"
      positions={positionsArtifact}
      vpoints={vpointsArtifact}
    />,
  );

// The section collapses by default; expand only when a previous render in
// this file has not already persisted the expanded state.
const expandIfCollapsed = () => {
  if (!screen.queryByTestId("backtest-history")) {
    fireEvent.click(screen.getByText(/Trade History/));
  }
};

const visibleRows = () => screen.getByTestId("backtest-history").textContent;

describe("filterBacktestTradeHistory", () => {
  const at = (value: string) => new Date(value).getTime();

  it("returns the same list when no filter is set", () => {
    expect(filterBacktestTradeHistory(positions, {})).toBe(positions);
  });

  it("combines account and entry-date bounds with AND semantics", () => {
    const filtered = filterBacktestTradeHistory(positions, {
      account: "acc-1",
      fromMs: at("2024-05-01T00:00:00"),
      toMs: at("2024-06-30T23:59:59.999"),
    });
    expect(filtered.map((trade) => trade.symbol)).toEqual(["SOL"]);
  });

  it("keeps only exits deeper than the bound on either level side", () => {
    const exits = [
      { account: "a", closed: { vPoint: { lvl: 4 } }, opened: { t: 1 }, symbol: "DEEP" },
      { account: "a", closed: { vPoint: { lvl: -5 } }, opened: { t: 2 }, symbol: "DEEP_SHORT" },
      { account: "a", closed: { vPoint: { lvl: 3 } }, opened: { t: 3 }, symbol: "EDGE" },
      { account: "a", closed: {}, opened: { t: 4 }, symbol: "NO_VPOINT" },
      { account: "a", opened: { t: 5 }, symbol: "STILL_OPEN" },
    ] as Position[];

    // Exclusive bound: level 3 stays out, +4 and -5 both pass by magnitude;
    // trades without an exit vPoint never satisfy a set bound.
    expect(
      filterBacktestTradeHistory(exits, { exitLevelGt: 3 }).map(
        (trade) => trade.symbol,
      ),
    ).toEqual(["DEEP", "DEEP_SHORT"]);
  });
});

describe("Backtest trade-history filters", () => {
  it("filters by account and shows the filtered count", async () => {
    const user = userEvent.setup();
    renderSection();
    expandIfCollapsed();

    expect(visibleRows()).toBe("acc-1:BTC,acc-2:ETH,acc-1:SOL,acc-2:SUI");

    await user.click(screen.getByRole("combobox", { name: "Account" }));
    await user.click(screen.getByRole("option", { name: "Alt (2)" }));

    expect(visibleRows()).toBe("acc-2:ETH,acc-2:SUI");
    expect(screen.getByText("Showing 2 of 4 trades")).toBeTruthy();
  });

  it("filters by inclusive entry-date bounds", () => {
    renderSection();
    expandIfCollapsed();

    fireEvent.change(screen.getByLabelText("Entry from"), {
      target: { value: "2024-05-01" },
    });
    expect(visibleRows()).toBe("acc-1:SOL,acc-2:SUI");

    fireEvent.change(screen.getByLabelText("Entry from"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Entry to"), {
      target: { value: "2024-04-30" },
    });
    expect(visibleRows()).toBe("acc-1:BTC,acc-2:ETH");
  });

  it("applies account and date filters together", async () => {
    const user = userEvent.setup();
    renderSection();
    expandIfCollapsed();

    await user.click(screen.getByRole("combobox", { name: "Account" }));
    await user.click(screen.getByRole("option", { name: "Main (2)" }));
    fireEvent.change(screen.getByLabelText("Entry from"), {
      target: { value: "2024-05-01" },
    });

    expect(visibleRows()).toBe("acc-1:SOL");
    expect(screen.getByText("Showing 1 of 4 trades")).toBeTruthy();
  });

  it("clears all filters at once", async () => {
    const user = userEvent.setup();
    renderSection();
    expandIfCollapsed();

    await user.click(screen.getByRole("combobox", { name: "Account" }));
    await user.click(screen.getByRole("option", { name: "Main (2)" }));
    fireEvent.change(screen.getByLabelText("Entry to"), {
      target: { value: "2024-01-01" },
    });
    expect(visibleRows()).toBe("");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(visibleRows()).toBe("acc-1:BTC,acc-2:ETH,acc-1:SOL,acc-2:SUI");
  });
});
