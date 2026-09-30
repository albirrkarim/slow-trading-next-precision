/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://current.reinventwp.com"}
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { endpoints } from "@/components/endpoints";
import SettingsDialogBlackSwanTab from "@/components/settings/Backswan/SettingsDialogBlackSwanTab";
import SettingsDialogRuntimeTab from "@/components/settings/Runtime/SettingsDialogRuntimeTab";
import SettingsDialogManagementTab from "@/components/settings/Management/SettingsDialogManagementTab";
import TradingAccountSettings from "@/components/settings/Trading/TradingAccountSettings";
import { makeConfigDraft } from "@/components/settings/helpers";
import { useLiveDashboardNavbar } from "@/components/dashboard/navigation/useLiveDashboardNavbar";
import { TradingMode } from "@/lib/exchange";
import { runtimeDefaults } from "@/lib/system/runtime";
import blackSwan, {
  type BlackSwanConfig,
} from "@/lib/system/trading/black-swan";

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
      minEntryAbsLevel: 3,
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
          minEntryAbsLevel: 3,
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

function EntryBoundsHarness() {
  const [tradingConfig, setTradingConfig] = useState(
    runtimeDefaults.trading.create(),
  );
  return (
    <>
      <TradingAccountSettings
        tradingConfig={tradingConfig}
        setTradingConfig={setTradingConfig}
      />
      <span data-testid="entry-bounds">
        {String(tradingConfig.minEntryAbsLevel)}|{String(tradingConfig.maxEntryAbsLevel)}
      </span>
      <span data-testid="drift-limit">
        {String(tradingConfig.lateEntryVPointPriceDriftPct)}
      </span>
    </>
  );
}

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
                    minEntryAbsLevel: 4,
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

  it("writes the strategy select into management", async () => {
    const user = userEvent.setup();
    const draft = makeConfigDraft(dashboardState());
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

    // Pair mode is per-account (`trading.entryLegs`) — no shared
    // Open Direction select remains.
    expect(screen.queryByLabelText("Open Direction")).toBeNull();

    await user.click(screen.getByLabelText("Strategy"));
    await user.click(screen.getByRole("option", { name: "Streak" }));
    expect(nextDraft.management.strategy).toBe("streak");

    rerender(
      <SettingsDialogManagementTab
        configDraft={nextDraft}
        setConfigDraft={setConfigDraft}
      />,
    );

    await user.click(screen.getByLabelText("Strategy"));
    await user.click(screen.getByRole("option", { name: "Default" }));
    expect(nextDraft.management.strategy).toBeUndefined();
  });

  it("writes entry legs on the account entry group", async () => {
    const user = userEvent.setup();

    function EntryLegsHarness() {
      const [tradingConfig, setTradingConfig] = useState(
        runtimeDefaults.trading.create(),
      );
      return (
        <>
          <TradingAccountSettings
            tradingConfig={tradingConfig}
            setTradingConfig={setTradingConfig}
          />
          <span data-testid="entry-legs">
            {String(tradingConfig.entryLegs)}
          </span>
        </>
      );
    }

    render(<EntryLegsHarness />);
    expect(screen.getByTestId("entry-legs").textContent).toBe("undefined");

    await user.click(screen.getByLabelText("Entry Legs"));
    await user.click(screen.getByRole("option", { name: "Counter" }));
    expect(screen.getByTestId("entry-legs").textContent).toBe("COUNTER");
  });

  it("keeps futures position mode edits in the draft without an accounts PUT", async () => {
    const user = userEvent.setup();
    const axiosPut = vi.mocked(axios.put);
    axiosPut.mockClear();
    const draft = makeConfigDraft(dashboardState());
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });

    render(
      <SettingsDialogManagementTab
        configDraft={nextDraft}
        setConfigDraft={setConfigDraft}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Manage exchange accounts" }),
    );
    await user.click(await screen.findByLabelText("Futures Position Mode"));
    await user.click(screen.getByRole("option", { name: "Hedge" }));

    // Account edits stay draft-only so the backtest settings draft never
    // reaches the live accounts endpoint; the Save button persists them.
    expect(
      nextDraft.accounts.find((account) => account.slug === "1")
        ?.futuresPositionMode,
    ).toBe("HEDGE");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      axiosPut.mock.calls.some(
        ([url]) => url === endpoints.system.account.list,
      ),
    ).toBe(false);
    axiosPut.mockClear();
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
      minEntryAbsLevel: 4,
      stopLossPercent: 12,
      takeProfitPercent: 7,
      useStopLossPlus: true,
    });
  });
});

describe("black swan breadth guard", () => {
  function renderTab(options: {
    customize?: (config: BlackSwanConfig) => BlackSwanConfig;
    minimumValidSymbols?: number;
    symbols?: string[];
  }) {
    const draft = makeConfigDraft(dashboardState());
    draft.management.symbols =
      options.symbols ?? ["BTC", "AAVE", "LINK", "SUI"];
    const blackSwanConfig: BlackSwanConfig = {
      ...blackSwan.config.defaults,
      enabled: true,
      breadthConfirmation: {
        ...blackSwan.config.defaults.breadthConfirmation,
        minimumValidSymbols: options.minimumValidSymbols ?? 5,
      },
    };
    draft.management.blackSwan =
      options.customize?.(blackSwanConfig) ?? blackSwanConfig;
    let nextDraft = draft;
    const setConfigDraft = vi.fn((update) => {
      nextDraft = typeof update === "function" ? update(nextDraft) : update;
    });
    render(
      <SettingsDialogBlackSwanTab
        configDraft={nextDraft}
        dashboardState={dashboardState()}
        setConfigDraft={setConfigDraft}
      />,
    );
    return { getDraft: () => nextDraft };
  }

  it("warns when configured non-BTC symbols cannot satisfy the breadth minimum", () => {
    renderTab({ minimumValidSymbols: 5 });

    expect(
      screen.getByText(/breadth CRISIS path cannot trigger/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/5 valid non-BTC symbols, but only 3 are configured/i),
    ).toBeTruthy();
  });

  it("counts unique normalized non-BTC symbols only", () => {
    renderTab({
      minimumValidSymbols: 5,
      symbols: ["BTC", "BTC_USDT", "btc_usdt", "SUI", "sui_usdt", "AAVE", "LINK"],
    });

    expect(
      screen.getByText(/5 valid non-BTC symbols, but only 3 are configured/i),
    ).toBeTruthy();
  });

  it("clears the warning once the minimum matches the configured symbols", () => {
    renderTab({ minimumValidSymbols: 3 });

    expect(
      screen.queryByText(/breadth CRISIS path cannot trigger/i),
    ).toBeNull();
  });

  it("resets detector thresholds to the calibrated defaults and preserves response controls", () => {
    const { getDraft } = renderTab({
      customize: (config) => ({
        ...config,
        btcWarning: {
          fifteenMinuteDrawdownPct: 9,
          fiveMinuteDrawdownPct: 4,
        },
        exitPolicy: "FLATTEN_ALL",
        maxDataAgeMinutes: 3,
        recoveryCooldownMinutes: 90,
        requireManualLiveRecovery: false,
      }),
      minimumValidSymbols: 5,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reset detector thresholds" }),
    );

    const next = getDraft().management.blackSwan!;
    expect(next.btcWarning).toEqual(blackSwan.config.defaults.btcWarning);
    expect(next.btcHardTrigger).toEqual(
      blackSwan.config.defaults.btcHardTrigger,
    );
    expect(next.breadthConfirmation).toEqual(
      blackSwan.config.defaults.breadthConfirmation,
    );
    expect(next.enabled).toBe(true);
    expect(next.exitPolicy).toBe("FLATTEN_ALL");
    expect(next.maxDataAgeMinutes).toBe(3);
    expect(next.recoveryCooldownMinutes).toBe(90);
    expect(next.requireManualLiveRecovery).toBe(false);
  });
});

describe("account entry-level settings", () => {
  it("keeps zero as an active maximum and clears either bound to undefined", () => {
    // BOTH:DECISION_V20_LEVEL_GATE
    render(<EntryBoundsHarness />);
    const minimum = screen.getByLabelText("Min Entry Absolute Level");
    const maximum = screen.getByLabelText("Max Entry Absolute Level");

    expect(screen.getByTestId("entry-bounds").textContent).toBe("2|undefined");
    fireEvent.change(maximum, { target: { value: "0" } });
    expect(screen.getByTestId("entry-bounds").textContent).toBe("2|0");
    fireEvent.change(minimum, { target: { value: "" } });
    expect(screen.getByTestId("entry-bounds").textContent).toBe("undefined|0");
    fireEvent.change(maximum, { target: { value: "" } });
    expect(screen.getByTestId("entry-bounds").textContent).toBe("undefined|undefined");
  });

  it("edits the late-entry drift limit as an optional decimal percent", () => {
    // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT
    render(<EntryBoundsHarness />);
    const input = screen.getByLabelText("Drift Limit %") as HTMLInputElement;

    expect(input.type).toBe("number");
    expect(input.min).toBe("0");
    expect(input.step).toBe("0.1");
    expect(screen.getByTestId("drift-limit").textContent).toBe("undefined");

    fireEvent.change(input, { target: { value: "0.2" } });
    expect(screen.getByTestId("drift-limit").textContent).toBe("0.2");

    // 0 is an active cap that blocks any profitable drift, not "unset".
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByTestId("drift-limit").textContent).toBe("0");

    // Clearing the field restores the automatic volatility-derived limit.
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("drift-limit").textContent).toBe("undefined");
  });

});
