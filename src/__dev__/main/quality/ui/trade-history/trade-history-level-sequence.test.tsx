/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { describe, expect, it, vi } from "vitest";

import { TradesTableSection } from "@/components/reports/TradesTableSection";
import { createTestPosition } from "../../fixtures/position";

vi.mock(
  "@/components/charts/NetProfitPercentHistorySparkline",
  () => ({
    NetProfitPercentHistorySparkline: () => (
      <div data-testid="pnl-history-chart" />
    ),
  }),
);

describe("trade-history level sequence", () => {
  it("shows the configured account name as a chip with trading notes", async () => {
    const position = createTestPosition({ account: "main", symbol: "SUI" });

    render(
      <SnackbarProvider>
        <TradesTableSection
          accounts={[
            {
              name: "Main",
              slug: "main",
              trading: { notes: "Common trade levels 1-3." },
            },
          ]}
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // PROD:TRADE_HISTORY_ACCOUNT_CHIP
    const accountChip = screen.getByLabelText("Account Main");
    expect(accountChip.closest(".MuiChip-root")).toBeTruthy();
    expect(screen.queryByText("Account: main")).toBeNull();
    fireEvent.mouseOver(accountChip);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Common trade levels 1-3.",
    );
  });

  it("shows the Standard stage text and reason on its exit icon", async () => {
    const position = createTestPosition({
      closed: {
        feeUsdt: 0,
        price: 11,
        reason: "TAKE_PROFIT",
        t: 300,
        vPoint: { id: "B_EXIT", lvl: -4 },
      },
      symbol: "SUI",
    });
    position.lastMonitoringStage = {
      stage: "standard",
      lastUpdated: 200,
      reason:
        "No Speedup rule matched: canonical net PnL 0.2%; PnL rules require >= +1.5% or <= -1.5%",
    };

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // PROD:MONITORING_OPEN_POSITION
    expect(screen.getByText("Last stage: standard")).toBeTruthy();
    expect(
      screen.getByText(
        "Reason: No Speedup rule matched: canonical net PnL 0.2%; PnL rules require >= +1.5% or <= -1.5%",
      ),
    ).toBeTruthy();
    // PROD:TRADE_HISTORY_EXIT_MONITORING_STAGE
    const exitStageIcon = screen.getByLabelText(
      "Standard monitoring stage at exit level -4",
    );
    expect(exitStageIcon.closest(".MuiChip-root")).toBeTruthy();
    fireEvent.mouseOver(exitStageIcon);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      position.lastMonitoringStage.reason,
    );
  });

  it("hides Speedup stage text and identifies it on the exit chip", async () => {
    const position = createTestPosition({
      closed: {
        feeUsdt: 0,
        price: 11,
        reason: "TAKE_PROFIT",
        t: 300,
        vPoint: { id: "B_EXIT", lvl: -4 },
      },
      symbol: "SUI",
    });
    position.lastMonitoringStage = {
      stage: "speedup",
      lastUpdated: 200,
      reason: "Positive PnL threshold matched",
    };

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // PROD:TRADE_HISTORY_EXIT_MONITORING_STAGE
    expect(screen.queryByText("Last stage: speedup")).toBeNull();
    expect(screen.queryByText(/Reason: Positive PnL threshold/)).toBeNull();

    const exitStageIcon = screen.getByLabelText(
      "Speedup monitoring stage at exit level -4",
    );
    expect(exitStageIcon.closest(".MuiChip-root")).toBeTruthy();
    fireEvent.mouseOver(exitStageIcon);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      position.lastMonitoringStage.reason,
    );
  });

  it("shows the persisted entry, averaging, and exit path below the PnL chart", async () => {
    const position = createTestPosition({
      averaging: {
        entryLevel: -2,
        executions: [
          {
            allocationPct: 2,
            level: -4,
            marginUsdt: 40,
            monitoringState: {
              lastUpdated: 250,
              reason: "No Speedup rule matched",
              stage: "standard",
            },
            price: 8,
            t: 250,
          },
          {
            allocationPct: 5,
            level: -3,
            marginUsdt: 20,
            monitoringState: {
              lastUpdated: 200,
              reason: "negative PnL threshold",
              stage: "speedup",
            },
            price: 9,
            t: 200,
          },
        ],
        lastHandledLevel: -3,
        reserveBaseMarginUsdt: 10,
        reservedRemainingMarginUsdt: 0,
        steps: [
          {
            allocationPct: 5,
            level: -3,
            marginUsdt: 20,
            status: "USED",
          },
        ],
      },
      closed: {
        feeUsdt: 0,
        message: "[EXIT] Target reached",
        price: 11,
        reason: "TAKE_PROFIT",
        t: 300,
        vPoint: { id: "B_EXIT", lvl: -4 },
      },
      entryLevel: -2,
      entryTime: 100,
      pnl: {
        history: [
          { pct: 0, t: 100, usdt: 0 },
          { pct: 10, t: 300, usdt: 1 },
        ],
        netPct: 10,
        netUsdt: 1,
        maxUpUsdt: 4.25,
        maxDownUsdt: -3.5,
      },
      symbol: "SUI",
      vPoints: [{ id: "B_AVERAGED_3", lvl: -3 }],
    });

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // BOTH:REUSABLE_LEVEL_SEQUENCE
    const pnlCell = screen.getByLabelText(
      "PnL history and level sequence for SUI",
    );
    const chart = within(pnlCell).getByTestId("pnl-history-chart");
    const sequence = within(pnlCell).getByLabelText("Position level sequence");

    expect(
      within(sequence)
        .getAllByText(/^L/)
        .map((chip) => chip.textContent),
    ).toEqual(["L-2", "L-3 AVG 5x", "L-4 AVG 2x EXIT"]);
    // BOTH:AVERAGING_MONITORING_STATE_SNAPSHOT
    const speedupState = within(sequence).getByLabelText(
      "Speedup monitoring state at averaging level -3",
    );
    expect(
      within(sequence).getByLabelText(
        "Standard monitoring state at averaging level -4",
      ),
    ).toBeTruthy();
    fireEvent.mouseOver(speedupState);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "negative PnL threshold",
    );
    expect(chart.nextElementSibling?.contains(sequence)).toBe(true);
    // BOTH:POSITION_PNL_USDT_EXTREMA
    expect(screen.getByText("Max Up USD")).toBeTruthy();
    expect(screen.getByText("Max Down USD")).toBeTruthy();
    expect(screen.getByText("$+4.25")).toBeTruthy();
    expect(screen.getByText("$-3.50")).toBeTruthy();
    expect(screen.queryByText("sandbox")).toBeNull();
  });

  it("shows persisted levels that were reached without averaging", () => {
    const position = createTestPosition({
      averaging: {
        entryLevel: -2,
        executions: [
          {
            allocationPct: 2,
            level: -4,
            marginUsdt: 40,
            price: 8,
            t: 250,
          },
        ],
        lastHandledLevel: -4,
        reserveBaseMarginUsdt: 10,
        reservedRemainingMarginUsdt: 0,
        steps: [],
      },
      closed: {
        feeUsdt: 0,
        message: "[EXIT] Closed",
        price: 11,
        reason: "TAKE_PROFIT",
        t: 300,
        vPoint: { id: "T_EXIT", lvl: 0 },
      },
      entryId: "B_ENTRY",
      entryLevel: -2,
      symbol: "SUI",
      vPoints: [
        { id: "B_NOT_AVERAGED", lvl: -3 },
        { id: "B_AVERAGED", lvl: -4 },
      ],
    });

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // BOTH:POSITION_VPOINT_PATH
    const sequence = screen.getByLabelText("Position level sequence");
    expect(
      within(sequence)
        .getAllByText(/^L/)
        .map((chip) => chip.textContent),
    ).toEqual(["L-2", "L-3 NOT AVG", "L-4 AVG 2x", "L0 T EXIT"]);
  });

  it("keeps the exit chip last when an earlier path point shares its level", () => {
    const position = createTestPosition({
      closed: {
        feeUsdt: 0,
        price: 11,
        reason: "STOP_LOSS",
        t: 300,
        vPoint: { id: "T_EXIT", lvl: 1 },
      },
      direction: "SHORT",
      entryId: "T_ENTRY",
      entryLevel: 0,
      symbol: "AAVE",
      vPoints: [
        { id: "T_EARLY", lvl: 1 },
        { id: "B_TARGET", lvl: 0 },
      ],
    });

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // Regression: the persisted path excludes the exit vPoint, so tagging
    // the first same-level intermediate misplaced EXIT ~the whole run early.
    const sequence = screen.getByLabelText("Position level sequence");
    expect(
      within(sequence)
        .getAllByText(/^L/)
        .map((chip) => chip.textContent),
    ).toEqual(["L0 T", "L1 NOT AVG", "L0 B", "L1 EXIT"]);
  });

  it("tags only the first same-level path point with one averaging execution", () => {
    const position = createTestPosition({
      averaging: {
        entryLevel: 0,
        executions: [
          {
            allocationPct: 2,
            level: 1,
            marginUsdt: 20,
            price: 0.57,
            t: 200,
          },
        ],
        lastHandledLevel: 1,
        reserveBaseMarginUsdt: 10,
        reservedRemainingMarginUsdt: 0,
        steps: [
          {
            allocationPct: 2,
            level: 1,
            marginUsdt: 20,
            status: "USED",
          },
        ],
      },
      closed: {
        feeUsdt: 0,
        price: 0.6,
        reason: "STOP_LOSS",
        t: 300,
        vPoint: { id: "T_EXIT", lvl: 2 },
      },
      direction: "SHORT",
      entryId: "T_ENTRY",
      entryLevel: 0,
      symbol: "XRP",
      vPoints: [
        { id: "T_AVERAGED", lvl: 1 },
        { id: "B_TARGET", lvl: 0 },
        { id: "T_AFTER_TARGET", lvl: 1 },
      ],
    });

    render(
      <SnackbarProvider>
        <TradesTableSection
          exchangeType="binance"
          history={[{ ...position, mode: "sandbox" }]}
          mode="sandbox"
          onHistoryChange={vi.fn()}
          readOnly
        />
      </SnackbarProvider>,
    );

    // Regression: level-keyed matching tagged every lvl-1 point with the
    // single fill — the post-target T point must stay NOT AVG.
    const sequence = screen.getByLabelText("Position level sequence");
    expect(
      within(sequence)
        .getAllByText(/^L/)
        .map((chip) => chip.textContent),
    ).toEqual([
      "L0 T",
      "L1 AVG 2x",
      "L0 B",
      "L1 NOT AVG",
      "L2 EXIT",
    ]);
  });
});
