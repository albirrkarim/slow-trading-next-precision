/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BacktestTradeHistory from "@/components/dev/backtest-precision/BacktestTradeHistory";
import { filterBacktestTradeHistory } from "@/components/dev/backtest-precision/trade-filters";
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

beforeEach(() => {
  // Filter values persist in localStorage between mounts — reset so each
  // test starts from the unfiltered state.
  window.localStorage.removeItem(
    "precision-backtest-trade-history-filters",
  );
});

const positions = [
  {
    account: "acc-1",
    closed: { t: day("2024-03-12"), vPoint: { lvl: 4 } },
    opened: { t: day("2024-03-10"), vPoint: { id: "B_1", lvl: 0 } },
    symbol: "BTC",
  },
  {
    account: "acc-2",
    closed: { t: day("2024-04-07"), vPoint: { lvl: 1 } },
    opened: { t: day("2024-04-05"), vPoint: { id: "T_1", lvl: 1 } },
    symbol: "ETH",
  },
  {
    account: "acc-1",
    closed: { t: day("2024-06-22"), vPoint: { lvl: -2 } },
    opened: { t: day("2024-06-20"), vPoint: { id: "B_2", lvl: -2 } },
    symbol: "SOL",
  },
  {
    account: "acc-2",
    closed: { t: day("2024-07-03"), vPoint: { lvl: 5 } },
    opened: { t: day("2024-07-01"), vPoint: { id: "B_4", lvl: -4 } },
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
      filterBacktestTradeHistory(exits, {
        metric: "exitLevel",
        operator: "gt",
        value: 3,
      }).map((trade) => trade.symbol),
    ).toEqual(["DEEP", "DEEP_SHORT"]);
  });

  it("keeps only entries shallower than the bound on either level side", () => {
    // Entry level < 1 isolates the level-0 entries; the -2 point passes a
    // < 3 bound by magnitude.
    expect(
      filterBacktestTradeHistory(positions, {
        metric: "entryLevel",
        operator: "lt",
        value: 1,
      }).map((trade) => trade.symbol),
    ).toEqual(["BTC"]);
    expect(
      filterBacktestTradeHistory(positions, {
        metric: "entryLevel",
        operator: "lt",
        value: 3,
      }).map((trade) => trade.symbol),
    ).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("evaluates every comparison operator against the metric value", () => {
    const run = (operator: "lt" | "lte" | "eq" | "gte" | "gt") =>
      filterBacktestTradeHistory(positions, {
        metric: "entryLevel",
        operator,
        value: 1,
      }).map((trade) => trade.symbol);

    expect(run("lt")).toEqual(["BTC"]);
    expect(run("lte")).toEqual(["BTC", "ETH"]);
    expect(run("eq")).toEqual(["ETH"]);
    expect(run("gte")).toEqual(["ETH", "SOL", "SUI"]);
    expect(run("gt")).toEqual(["SOL", "SUI"]);
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

  it("filters by the composable metric condition", async () => {
    const user = userEvent.setup();
    renderSection();
    expandIfCollapsed();

    // Defaults: `Entry level <` — typing a value filters immediately.
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "1" },
    });
    expect(visibleRows()).toBe("acc-1:BTC");

    await user.click(screen.getByRole("combobox", { name: "Metric" }));
    await user.click(screen.getByRole("option", { name: "Exit level" }));
    await user.click(screen.getByRole("combobox", { name: "Op" }));
    await user.click(screen.getByRole("option", { name: ">" }));

    // Exit |level| > 1 → BTC (4), SOL (-2 by magnitude), SUI (5).
    expect(visibleRows()).toBe("acc-1:BTC,acc-1:SOL,acc-2:SUI");
    expect(screen.getByText("Showing 3 of 4 trades")).toBeTruthy();
  });

  it("migrates the stored legacy exit-level bound into the condition", () => {
    window.localStorage.setItem(
      "precision-backtest-trade-history-filters",
      JSON.stringify({ exitLevel: "3" }),
    );
    renderSection();
    expandIfCollapsed();

    // Legacy `exitLevel: 3` becomes `Exit level > 3` → BTC (4) and SUI (5).
    expect(visibleRows()).toBe("acc-1:BTC,acc-2:SUI");
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
