/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PrecisionChecker from "@/components/dev/PrecisionChecker";
import { endpoints } from "@/components/endpoints";

vi.mock("axios");

vi.mock("@/components/ui/SidebarButton", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/Chart/MultiLineTimelined", () => ({
  default: ({ names, series }: { names: string[]; series: { level: number }[][] }) => (
    <div data-testid="volatility-chart">
      {JSON.stringify({ names, levels: series.map((points) => points.map((point) => point.level)) })}
    </div>
  ),
}));

vi.mock("@/components/LiveDashboard/Reporting/TradesTableSection", () => ({
  TradesTableSection: ({
    history,
    mode,
  }: {
    history: { symbol: string; mode: string }[];
    mode: string;
  }) => (
    <div data-testid="trades-table" data-mode={mode}>
      {history.map((position) => `${position.symbol}:${position.mode}`).join(",")}
    </div>
  ),
}));

const testCase = {
  fileName: "sandbox-01-01-2024-00-00-02-01-2024-00-00.json",
  mode: "sandbox",
  startTime: 1,
  endTime: 2,
  tradeCount: 1,
};

const runResult = {
  testCase,
  accounts: [{ slug: "acc-1", name: "Account 1" }],
  exchangeType: "binance",
  productionHistory: [{ symbol: "SUI" }],
  backtestHistory: [{ symbol: "BACK" }],
  productionVPointsMap: {
    SUI: [{ id: "prod", t: 1_000, l: "B", lvl: -2, pct: 5, p: 1 }],
  },
  backtestVPointsMap: {
    BTC: [{ id: "back", t: 2_000, l: "T", lvl: 3, pct: 6, p: 2 }],
  },
};

describe("Precision Checker page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads captures, runs the selected case, and renders both histories", async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockResolvedValue({
      data: { testCases: [testCase] },
    });
    vi.mocked(axios.post).mockResolvedValue({ data: runResult });

    render(<PrecisionChecker />);

    expect(await screen.findByText(/sandbox · .* · 1 trades/)).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /run backtest/i }),
    );

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        endpoints.dev.precisionChecker,
        { fileName: testCase.fileName },
      );
    });

    expect(await screen.findByText("Production History (1)")).toBeTruthy();
    expect(screen.getByText("Backtest History (1)")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Production Volatility points" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Backtest Volatility points" })).toBeTruthy();
    const charts = screen.getAllByTestId("volatility-chart");
    expect(charts).toHaveLength(2);
    expect(charts[0].textContent).toBe('{"names":["SUI"],"levels":[[-2]]}');
    expect(charts[1].textContent).toBe('{"names":["BTC"],"levels":[[3]]}');

    await user.click(screen.getByText("Production Volatility points"));
    expect(screen.getAllByTestId("volatility-chart")).toHaveLength(1);
    expect(screen.getByText("Backtest Volatility points")).toBeTruthy();

    await user.click(screen.getByText("Backtest Volatility points"));
    expect(screen.queryByTestId("volatility-chart")).toBeNull();

    await user.click(screen.getByText("Production Volatility points"));
    expect(screen.getAllByTestId("volatility-chart")).toHaveLength(1);

    const tables = screen.getAllByTestId("trades-table");
    expect(tables).toHaveLength(2);
    expect(tables[0].textContent).toBe("SUI:sandbox");
    expect(tables[0].dataset.mode).toBe("sandbox");
    expect(tables[1].textContent).toBe("BACK:sandbox");
    expect(tables[1].dataset.mode).toBe("sandbox");
  });
});
