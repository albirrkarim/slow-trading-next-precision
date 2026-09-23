/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://current.reinventwp.com"}
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { describe, expect, it, vi } from "vitest";

import { endpoints } from "@/components/endpoints";
import SettingsDialogBlackSwanTab from "@/components/LiveDashboard/Navbar/Settings/Backswan/SettingsDialogBlackSwanTab";
import SettingsDialogRuntimeTab from "@/components/LiveDashboard/Navbar/Settings/Runtime/SettingsDialogRuntimeTab";
import SettingsDialogManagementTab from "@/components/LiveDashboard/Navbar/Settings/Management/SettingsDialogManagementTab";
import { makeConfigDraft } from "@/components/LiveDashboard/Navbar/Settings/helpers";
import { useLiveDashboardNavbar } from "@/components/LiveDashboard/Navbar/useLiveDashboardNavbar";
import { TradingMode } from "@/lib/exchange";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(async () => ({ data: {} })),
  },
}));

function dashboardState() {
  return {
    activeMode: "live",
    balances: {
      availableQuoteAsset: 1_000,
      lockedQuoteAsset: 0,
      reservedQuoteAsset: 0,
      safeHaven: 0,
      spendableQuoteAsset: 1_000,
      startingBalanceUSDT: 1_000,
    },
    config: {
      adaptiveAveraging: {
        enabled: false,
        maxMultiplier: 5,
        minProjectedProfitPct: 2,
      },
      averagingRescueProjectionGuardEnabled: true,
      decisionEngineVersion: "decision.v19",
      description: "",
      enableWatchLogic: false,
      exchangeType: "binance",
      maxEntryMargin: 0,
      maxEntryBased24HourVolPct: 0.2,
      maxEntryMarginPct: 0,
      minActionableAbsoluteLevel: 3,
      maxLeverage: 0,
      exactLeverage: 0,
      orderType: "taker",
      safePercentPerMonth: 0,
      safeUSDTPerMonth: 0,
      stopLossPercent: 20,
      takeProfitPercent: 5,
      useStopLossPlus: false,
      name: "Main",
      symbols: ["BTC"],
      tradingMode: TradingMode.SPOT,
      watchMaxNextAveragingLevels: 2,
      watchReserveLevels: 2,
      watchReservePctAlloc: 2,
    },
    history: [],
    openPositions: [],
    accounts: [
      {
        createdAt: 1,
        credentials: {
          apiKey: "key",
          apiSecret: "secret",
        },
        description: "",
        slug: "1",
        enabled: true,
        name: "Main Account",
        trading: {
          adaptiveAveraging: {
            enabled: false,
            maxMultiplier: 5,
            minProjectedProfitPct: 2,
          },
          averagingRescueProjectionGuardEnabled: true,
          enableWatchLogic: false,
          exactLeverage: 0,
          maxEntryBased24HourVolPct: 0.2,
          maxEntryMargin: 0,
          maxEntryMarginPct: 0,
          maxLeverage: 0,
          maxOpenPositions: 0,
          minActionableAbsoluteLevel: 3,
          notes: "",
          stopLossPercent: 20,
          takeProfitPercent: 5,
          useStopLossPlus: false,
          watchMaxNextAveragingLevels: 2,
          watchReserveLevels: 2,
          watchReservePctAlloc: 2,
        },
        sandbox: { initialBalanceUSDT: 1_000 },
        type: "binance",
        updatedAt: 1,
      },
    ],
    runtime: {
      autoEntryEnabled: false,
      autoExitEnabled: false,
      autoRemoveSymbolAbsLevel: 0,
      autoRemoveSymbolMinMarketCapUSD: 0,
      autoRemoveSymbolMinPrice: 0,
      entrySignalBypass: false,
      mcp: { tokens: [] },
      notification: {
        email: {
          enabled: false,
          types: [],
        },
        telegram: {
          enabled: false,
          types: [],
        },
      },
      pnlHistoryBucketMinutes: 60,
      runnerEnabled: false,
      sandboxEnabled: false,
      withdrawal: {
        autoEnabled: false,
        schedules: [],
        walletBook: [],
      },
      safeHaven: { autoEnabled: false, schedules: [] },
    },
    stats: {
      closedTrades: 0,
      openPositions: 0,
    },
  } as any;
}

const BASE_DASHBOARD_STATE = dashboardState();

function Harness() {
  const navbar = useLiveDashboardNavbar({
    dashboardState: BASE_DASHBOARD_STATE,
    onRefresh: vi.fn(async () => undefined),
    selectedAccountSlug: "1",
    setSelectedAccountSlug: vi.fn(),
  });

  if (!navbar.configDraft) {
    return <div>Loading</div>;
  }

  return (
    <div>
      <div data-testid="auto-remove">
        {navbar.configDraft.runtime.autoRemoveSymbolAbsLevel}
      </div>
      <div data-testid="auto-remove-price">
        {navbar.configDraft.runtime.autoRemoveSymbolMinPrice}
      </div>
      <div data-testid="auto-remove-market-cap">
        {navbar.configDraft.runtime.autoRemoveSymbolMinMarketCapUSD}
      </div>
      <div data-testid="auto-remove-vpoint-pct">
        {navbar.configDraft.runtime.autoRemoveSymbolMinVPointPct}
      </div>
      <button
        type="button"
        onClick={() =>
          navbar.setConfigDraft((prev) =>
            prev
              ? {
                ...prev,
                management: { ...prev.management, symbols: ["SUI", "AAVE"] },
                runtime: {
                  ...prev.runtime,
                  autoEntryEnabled: true,
                  autoExitEnabled: true,
                  autoRemoveSymbolAbsLevel: 6,
                  autoRemoveSymbolMinMarketCapUSD: 100_000_000,
                  autoRemoveSymbolMinPrice: 0.01,
                  autoRemoveSymbolMinVPointPct: 17.5,
                  pnlHistoryBucketMinutes: 15,
                  runnerEnabled: true,
                  notification: {
                  ...prev.runtime.notification,
                  telegram: {
                    enabled: true,
                    types: [
                      {
                        id: "NOTIF_HIGH_VOLATILITY",
                        params: { level: 4 },
                      },
                      {
                        id: "NOTIF_STALE_POSITION",
                        params: { hour: 2 },
                      },
                    ],
                  },
                },
                },
                accounts: prev.accounts.map((account) => ({
                  ...account,
                  trading: {
                    ...account.trading,
                    averagingRescueProjectionGuardEnabled: false,
                    enableWatchLogic: true,
                    maxEntryMargin: 20,
                    maxEntryBased24HourVolPct: 0.5,
                    maxEntryMarginPct: 50,
                    maxOpenPositions: 3,
                    minActionableAbsoluteLevel: 4,
                    maxLeverage: 3,
                    exactLeverage: 6,
                    stopLossPercent: 12,
                    takeProfitPercent: 7,
                    useStopLossPlus: true,
                  },
                })),
              }
              : prev,
          )
        }
      >
        Mutate Draft
      </button>
      <button
        type="button"
        onClick={() => {
          void navbar.saveConfig();
        }}
      >
        Save Draft
      </button>
    </div>
  );
}

describe("settings dialog save payload", () => {
  // PROD:BLACK_SWAN_SAVINGS_PREVIEW_RESOURCE_GUARD
  it("keeps the Black Swan replay opt-in and cancels it when hidden", async () => {
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockClear();
    axiosPost.mockImplementationOnce(() => new Promise(() => undefined));
    const draft = makeConfigDraft(dashboardState());
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    const { rerender } = render(
      <SettingsDialogBlackSwanTab
        configDraft={nextDraft}
        dashboardState={dashboardState()}
        setConfigDraft={setConfigDraft}
      />,
    );

    expect(screen.getByText("Portfolio crash protection")).toBeTruthy();
    expect(screen.getByText("Crisis response and recovery")).toBeTruthy();
    expect(screen.getByText("BTC warning and crisis thresholds")).toBeTruthy();
    expect(screen.getByText("Altcoin breadth confirmation")).toBeTruthy();
    const previewToggle = screen.getByLabelText(
      "Load Black Swan live preview",
    ) as HTMLInputElement;
    expect(previewToggle.checked).toBe(false);
    expect(screen.queryByText("Black Swan Protection Replay")).toBeNull();
    expect(axiosPost).not.toHaveBeenCalled();

    fireEvent.click(previewToggle);
    expect(previewToggle.checked).toBe(true);
    expect(screen.getByText("Black Swan Protection Replay")).toBeTruthy();
    expect(
      screen.getByText(/unchanged generator builds 5-minute vPoints/i),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Start (local time)") as HTMLInputElement).type,
    ).toBe("datetime-local");
    expect(
      (screen.getByLabelText("End (local time)") as HTMLInputElement).type,
    ).toBe("datetime-local");
    expect(
      (screen.getByLabelText("Use cached klines") as HTMLInputElement).checked,
    ).toBe(true);
    await waitFor(
      () =>
        expect(axiosPost).toHaveBeenCalledWith(
          endpoints.system.blackSwan.preview,
          expect.any(Object),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ),
      { timeout: 2_000 },
    );
    const requestSignal = (axiosPost.mock.calls[0][2] as { signal: AbortSignal })
      .signal;
    expect(requestSignal.aborted).toBe(false);

    fireEvent.click(previewToggle);
    expect(screen.queryByText("Black Swan Protection Replay")).toBeNull();
    expect(requestSignal.aborted).toBe(true);
    expect(
      screen.getAllByText("NORMAL", { selector: ".MuiChip-label" }),
    ).toHaveLength(2);
    expect(
      screen.getByText("WATCH", { selector: ".MuiChip-label" }),
    ).toBeTruthy();
    expect(
      screen.getByText("CRISIS", { selector: ".MuiChip-label" }),
    ).toBeTruthy();
    expect(
      screen.getByText("RECOVERY", { selector: ".MuiChip-label" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Black Swan Protection: OFF"));
    expect(nextDraft.management.blackSwan?.enabled).toBe(true);

    rerender(
      <SettingsDialogBlackSwanTab
        configDraft={nextDraft}
        dashboardState={dashboardState()}
        setConfigDraft={setConfigDraft}
      />,
    );
    expect(screen.getByLabelText("Black Swan Protection: ON")).toBeTruthy();

    const interval = screen.getByLabelText(
      "Risk Sentinel Interval (Minutes)",
    ) as HTMLInputElement;
    expect(interval.type).toBe("number");
    expect(interval.min).toBe("1");
  });

  it("edits the PnL history bucket as whole positive minutes", () => {
    const draft = makeConfigDraft(dashboardState());
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    render(
      <SettingsDialogRuntimeTab
        configDraft={draft}
        onReinitialize={vi.fn(async () => undefined)}
        reinitializing={false}
        resetSandbox={vi.fn(async () => undefined)}
        resettingSandboxAccount={null}
        setConfigDraft={setConfigDraft}
        syncOnlineStorageToLocal={vi.fn(async () => undefined)}
        syncingOnlineStorage={false}
      />,
    );

    expect(screen.queryByText("Portfolio crash protection")).toBeNull();

    const input = screen.getByLabelText(
      "PnL History Bucket (Minutes)",
    ) as HTMLInputElement;
    expect(input.min).toBe("1");

    fireEvent.change(input, { target: { value: "15.8" } });
    expect(nextDraft.runtime.pnlHistoryBucketMinutes).toBe(15);
  });

  it("edits all production stage intervals as positive whole minutes", () => {
    const draft = makeConfigDraft(dashboardState());
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    render(
      <SettingsDialogRuntimeTab
        configDraft={draft}
        onReinitialize={vi.fn(async () => undefined)}
        reinitializing={false}
        resetSandbox={vi.fn(async () => undefined)}
        resettingSandboxAccount={null}
        setConfigDraft={setConfigDraft}
        syncOnlineStorageToLocal={vi.fn(async () => undefined)}
        syncingOnlineStorage={false}
      />,
    );

    for (const [label, field] of [
      ["Speedup Stage Interval (Minutes)", "speedupStageIntervalMinutes"],
      [
        "Standard Monitoring Interval (Minutes)",
        "standardMonitoringStageIntervalMinutes",
      ],
      ["Capture Entry Interval (Minutes)", "captureEntryStageIntervalMinutes"],
      ["Management Cycle Interval (Minutes)", "managementStageIntervalMinutes"],
    ] as const) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.min).toBe("1");
      fireEvent.change(input, { target: { value: "2.9" } });
      expect(nextDraft.runtime[field]).toBe(2);
    }

    for (const [label, field, value] of [
      [
        "Positive PnL Threshold (%)",
        "speedupStagePositivePnlThresholdPct",
        "2.25",
      ],
      [
        "Negative PnL Threshold (%)",
        "speedupStageNegativePnlThresholdPct",
        "3.25",
      ],
      [
        "Take Profit Proximity Offset (%)",
        "speedupStageTakeProfitOffsetPct",
        "0.75",
      ],
    ] as const) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.min).toBe("0");
      expect(input.step).toBe("0.1");
      fireEvent.change(input, { target: { value } });
      expect(nextDraft.runtime[field]).toBe(Number(value));
    }

    expect(screen.getByText("A. Speedup Stage")).toBeTruthy();
    expect(screen.getByText("B. Standard Monitoring")).toBeTruthy();
    expect(screen.getByText("C. Management")).toBeTruthy();
    expect(screen.getByText("D. Capture Entry")).toBeTruthy();
    expect(screen.getByText("E. PnL History")).toBeTruthy();
    for (const rule of [
      "1. Positive PnL threshold",
      "2. Negative PnL threshold",
      "3. StopLoss+ armed",
      "4. Near take profit",
      "5. Post-average target approach",
      "6. Target vPoint hit",
    ]) {
      expect(screen.getByText(rule)).toBeTruthy();
    }
  });

  it("edits the full-history vpoint pct rule as a decimal percentage", () => {
    const draft = makeConfigDraft(dashboardState());
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    render(
      <SettingsDialogManagementTab
        configDraft={draft}
        setConfigDraft={setConfigDraft}
      />,
    );

    const input = screen.getByLabelText(
      "Based on Any vPoint (%)",
    ) as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.min).toBe("0");
    expect(input.step).toBe("any");
    expect(input.value).toBe("15");

    fireEvent.change(input, { target: { value: "17.5" } });
    expect(nextDraft.runtime.autoRemoveSymbolMinVPointPct).toBe(17.5);
  });

  it("previews the market-cap input with readable M and B units", () => {
    const draft = makeConfigDraft(dashboardState());
    draft.runtime.autoRemoveSymbolMinMarketCapUSD = 200_000_000;
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    const { rerender } = render(
      <SettingsDialogManagementTab
        configDraft={nextDraft}
        setConfigDraft={setConfigDraft}
      />,
    );

    // PROD:AUTO_REMOVE_MARKET_CAP_INPUT_PREVIEW
    expect(screen.getByText("Preview: USD 200M")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Based on Market Cap (USD)"), {
      target: { value: "1500000000" },
    });
    rerender(
      <SettingsDialogManagementTab
        configDraft={nextDraft}
        setConfigDraft={setConfigDraft}
      />,
    );
    expect(screen.getByText("Preview: USD 1.5B")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Based on Market Cap (USD)"), {
      target: { value: "0" },
    });
    rerender(
      <SettingsDialogManagementTab
        configDraft={nextDraft}
        setConfigDraft={setConfigDraft}
      />,
    );
    expect(screen.getByText("Preview: Disabled")).toBeTruthy();
  });

  it("allows storage cloning from a deployed dashboard host", () => {
    const syncOnlineStorageToLocal = vi.fn(async () => undefined);

    render(
      <SettingsDialogRuntimeTab
        configDraft={makeConfigDraft(dashboardState())}
        onReinitialize={vi.fn(async () => undefined)}
        reinitializing={false}
        resetSandbox={vi.fn(async () => undefined)}
        resettingSandboxAccount={null}
        setConfigDraft={vi.fn()}
        syncOnlineStorageToLocal={syncOnlineStorageToLocal}
        syncingOnlineStorage={false}
      />,
    );

    // PROD:SYNC_ONLINE_TO_LOCAL
    expect(window.location.hostname).toBe("current.reinventwp.com");
    expect(
      (screen.getByLabelText("Remote Server Base URL") as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Clone Storage to This Server",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("saves visible setting values to the correct storage payload fields", async () => {
    const user = userEvent.setup();
    const axiosPut = vi.mocked(axios.put);

    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Mutate Draft" }));
    await waitFor(() => {
      expect(screen.getByTestId("auto-remove").textContent).toBe("6");
      expect(screen.getByTestId("auto-remove-price").textContent).toBe("0.01");
      expect(screen.getByTestId("auto-remove-market-cap").textContent).toBe(
        "100000000",
      );
      expect(screen.getByTestId("auto-remove-vpoint-pct").textContent).toBe(
        "17.5",
      );
    });

    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(axiosPut).toHaveBeenCalledWith(
        endpoints.system.state,
        expect.any(Object),
      );
    });

    const payload = axiosPut.mock.calls.find(
      ([url]) => url === endpoints.system.state,
    )?.[1] as any;
    expect(payload).toMatchObject({
      autoEntryEnabled: true,
      autoExitEnabled: true,
      autoRemoveSymbolAbsLevel: 6,
      autoRemoveSymbolMinMarketCapUSD: 100_000_000,
      autoRemoveSymbolMinPrice: 0.01,
      autoRemoveSymbolMinVPointPct: 17.5,
      pnlHistoryBucketMinutes: 15,
      account: "1",
      notification: {
        telegram: {
          enabled: true,
          types: [
            {
              id: "NOTIF_HIGH_VOLATILITY",
              params: { level: 4 },
            },
            {
              id: "NOTIF_STALE_POSITION",
              params: { hour: 2 },
            },
          ],
        },
      },
      runnerEnabled: true,
      config: {
        symbols: ["SUI", "AAVE"],
      },
    });

    const accountsPayload = axiosPut.mock.calls.find(
      ([url]) => url === endpoints.system.account.list,
    )?.[1] as any;
    expect(accountsPayload.accounts[0].trading).toMatchObject({
      averagingRescueProjectionGuardEnabled: false,
      enableWatchLogic: true,
      exactLeverage: 6,
      maxEntryBased24HourVolPct: 0.5,
      maxEntryMargin: 20,
      maxEntryMarginPct: 50,
      maxLeverage: 3,
      maxOpenPositions: 3,
      minActionableAbsoluteLevel: 4,
      stopLossPercent: 12,
      takeProfitPercent: 7,
      useStopLossPlus: true,
    });
  });
});
