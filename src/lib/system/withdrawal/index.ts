import { getExchange } from "@/lib/exchange";
import { runWithExchangeAccount } from "@/lib/exchange/account-context";
import { TradingMode } from "@/lib/exchange/types";
import runtimeAccountConfig from "../runtime/account-config";
import type {
  RuntimeWithdrawalConfig,
  RuntimeWithdrawalSchedule,
} from "../runtime/types";
import { runtimeLogs, runtimeStorage } from "../storage";
import runtimeAccountState from "../storage/account-state";
import type { RuntimeMode } from "../storage/runtime";
import runtimeWithdrawalSchedule from "./schedule";

const MAX_MANUAL_WITHDRAW_USDT = 2;

/** Maps the persisted trading-mode union to the exchange enum value. */
function toExchangeTradingMode(tradingMode: TradingMode | string | undefined): TradingMode {
  switch (tradingMode) {
    case "futures":
      return TradingMode.FUTURES;
    case "margin_cross":
      return TradingMode.MARGIN_CROSS;
    case "margin_isolated":
      return TradingMode.MARGIN_ISOLATED;
    default:
      return TradingMode.SPOT;
  }
}

/** Resolves the amount submitted for a manual or automatic withdrawal. */
function getExecutionAmountUSDT(
  configuredAmountUSDT: number,
  trigger: "manual" | "automatic",
): number {
  const normalizedAmountUSDT = Math.max(0, Number(configuredAmountUSDT) || 0);

  // PROD:MANUAL_WITHDRAWAL_CAP
  // PROD:AUTOMATIC_WITHDRAWAL_AMOUNT
  return trigger === "manual"
    ? Math.min(normalizedAmountUSDT, MAX_MANUAL_WITHDRAW_USDT)
    : normalizedAmountUSDT;
}

/** Result returned after trying one withdrawal schedule. */
export interface RuntimeWithdrawalExecutionResult {
  /** Immutable account slug whose funds were inspected. */
  account: string;
  /** Runtime mode active when the withdrawal flow ran. */
  activeMode: RuntimeMode;
  /** Withdrawal amount after trigger-specific safety limits. */
  amountUSDT: number;
  /** Safe Haven balance available before execution. */
  availableSafeHavenUSDT: number;
  /** Whether all checks allowed the withdrawal to execute. */
  canExecute: boolean;
  /** Whether the result came from a non-mutating dry run. */
  dryRun: boolean;
  /** Whether a real exchange withdrawal was submitted. */
  executed: boolean;
  /** Human-readable result message. */
  message: string;
  /** Schedule id used for the withdrawal flow. */
  scheduleId: string;
  /** Schedule name used for the withdrawal flow. */
  scheduleName: string;
  /** Target withdrawal network. */
  targetNetwork: string;
  /** Target withdrawal wallet address. */
  targetWalletAddress: string;
  /** Exchange withdrawal id returned after successful submission. */
  withdrawId?: string;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

/** Patches schedule status into the withdrawal schedule state. */
function patchScheduleStatus(
  withdrawal: RuntimeWithdrawalConfig,
  scheduleId: string,
  patch: Partial<RuntimeWithdrawalSchedule>,
): Partial<RuntimeWithdrawalConfig> {
  return {
    ...withdrawal,
    schedules: withdrawal.schedules.map((schedule) =>
      schedule.id === scheduleId ? { ...schedule, ...patch } : schedule,
    ),
  };
}

/**
 * Executes one withdrawal schedule from validation through final runtime
 * state updates.
 */
async function executeSchedule(params: {
  clientWithdrawId?: string;
  enforceInterval?: boolean;
  logAttempts?: boolean;
  scheduleId: string;
  trigger?: "manual" | "automatic";
}): Promise<RuntimeWithdrawalExecutionResult> {
  // A. Load the catalog and resolve the selected schedule.
  const trigger = params.trigger ?? "manual";
  const logAttempts = params.logAttempts !== false;
  const catalog = await runtimeStorage.catalog.ensure();
  const withdrawal = catalog.config.runtime.withdrawal ?? {
    autoEnabled: false,
    schedules: [],
    walletBook: [],
  };
  const schedule =
    withdrawal.schedules.find((item) => item.id === params.scheduleId) ?? null;
  const account =
    catalog.config.accounts.find((item) => item.slug === schedule?.account) ??
    catalog.config.accounts[0];
  const activeMode = catalog.mode;

  if (!schedule || !account) {
    await runtimeLogs.appendWithdrawal({
      account: account?.slug ?? "unknown",
      trigger,
      status: "failed",
      mode: activeMode,
      scheduleId: params.scheduleId,
      message: "Please choose which withdrawal schedule to run.",
    });
    throw new Error("Please choose which withdrawal schedule to run.");
  }

  const modeState = await runtimeStorage.account.load({
    accountSlug: account.slug,
    mode: activeMode,
  });
  const effective = runtimeAccountConfig.effective(
    catalog.config.management,
    account,
  );

  // B. Normalize schedule input into the exact withdrawal target.
  const configuredAmountUSDT = Math.max(0, Number(schedule.amountUSDT) || 0);
  const amountUSDT = getExecutionAmountUSDT(configuredAmountUSDT, trigger);
  const wallet = schedule.walletId
    ? withdrawal.walletBook.find((item) => item.id === schedule.walletId)
    : undefined;
  const targetNetwork = normalizeString(wallet?.network ?? schedule.targetNetwork);
  const targetWalletAddress = normalizeString(
    wallet?.address ?? schedule.targetWalletAddress,
  );
  const availableSafeHavenUSDT = Math.max(
    0,
    Number(modeState.balance.safeHaven) || 0,
  );
  const baseResponse = {
    account: account.slug,
    activeMode,
    amountUSDT,
    availableSafeHavenUSDT,
    dryRun: false,
    executed: false,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    targetNetwork,
    targetWalletAddress,
  };

  // C. Prepare schedule-scoped logging and failure helpers.
  const writeWithdrawalLog = (logInput: {
    message: string;
    status: "attempted" | "skipped" | "failed" | "executed";
    withdrawId?: string;
  }) => {
    if (!logAttempts) {
      return Promise.resolve(null);
    }

    return runtimeLogs.appendWithdrawal({
      account: account.slug,
      trigger,
      status: logInput.status,
      mode: activeMode,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      amountUSDT,
      availableSafeHavenUSDT,
      targetNetwork,
      targetWalletAddress,
      message: logInput.message,
      ...(logInput.withdrawId ? { withdrawId: logInput.withdrawId } : {}),
    });
  };

  await writeWithdrawalLog({
    status: "attempted",
    message: `Trying ${trigger} withdrawal schedule "${schedule.name}" for ${amountUSDT} USDT.`,
  });

  const failWithdrawal = async (message: string): Promise<never> => {
    await writeWithdrawalLog({
      status: "failed",
      message,
    });
    throw new Error(message);
  };

  // D. Validate all safety gates before touching real funds.
  if (!schedule.enabled) {
    await failWithdrawal("Selected withdrawal schedule is disabled.");
  }

  // D.1 Respect the recurring monthly date when automatic mode asks for it.
  if (
    params.enforceInterval &&
    !runtimeWithdrawalSchedule.timing.isDue(schedule, Date.now())
  ) {
    await writeWithdrawalLog({
      status: "skipped",
      message: "Selected withdrawal schedule is not due yet.",
    });
    return {
      ...baseResponse,
      canExecute: false,
      message: "Selected withdrawal schedule is not due yet.",
    };
  }

  if (activeMode !== "live") {
    await failWithdrawal("Real withdrawal is blocked while SLOW is in sandbox mode.");
  }

  if (effective.exchangeType !== "binance") {
    await failWithdrawal("Real withdrawal is currently implemented only for Binance.");
  }

  if (!(configuredAmountUSDT > 0)) {
    await failWithdrawal("Withdrawal amount must be greater than 0 USDT.");
  }

  if (!targetNetwork) {
    await failWithdrawal("Target network is required before trying the withdraw flow.");
  }

  if (!targetWalletAddress) {
    await failWithdrawal("Target wallet address is required before trying the withdraw flow.");
  }

  if (availableSafeHavenUSDT < amountUSDT) {
    await failWithdrawal("Safe Haven balance is lower than the configured withdrawal amount.");
  }

  // E. Submit the real exchange withdrawal and persist the successful state.
  try {
    const response = await runWithExchangeAccount(
      runtimeAccountState.toExchangeAccount(account),
      async () => {
        const exchange = getExchange(effective.exchangeType, {
          defaultTradingMode: toExchangeTradingMode(effective.tradingMode),
        });

        return exchange.withdrawAsset({
          asset: "USDT",
          address: targetWalletAddress,
          amount: amountUSDT,
          network: targetNetwork,
          clientWithdrawId:
            params.clientWithdrawId ??
            `slow-${schedule.id}-${Date.now()}`.slice(0, 64),
        });
      },
    );
    const nextSafeHavenUSDT = Math.max(
      0,
      availableSafeHavenUSDT - amountUSDT,
    );
    const timestamp = Date.now();

    await runtimeStorage.catalog.update({
      // PROD:MULTI_ACCOUNT_WITHDRAWAL_OWNER
      account: account.slug,
      safeHavenUSDT: nextSafeHavenUSDT,
      safeHavenLogReason: `Withdrawal schedule "${schedule.name}" executed`,
      safeHavenLogSource: "withdrawal",
      withdrawal: patchScheduleStatus(withdrawal, schedule.id, {
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        lastStatus: `EXECUTED:${response.id}`,
      }),
    });

    const message = `Submitted real Binance USDT withdrawal for ${amountUSDT} USDT from schedule "${schedule.name}". Binance withdraw id: ${response.id}`;
    await writeWithdrawalLog({
      status: "executed",
      message,
      withdrawId: response.id,
    });

    return {
      ...baseResponse,
      canExecute: true,
      executed: true,
      message,
      withdrawId: response.id,
    };
  } catch (error: any) {
    // E.1 Persist failed attempts so the UI can review what happened.
    await runtimeStorage.catalog.update({
      withdrawal: patchScheduleStatus(withdrawal, schedule.id, {
        lastAttemptAt: Date.now(),
        lastStatus: `FAILED:${error?.message ?? "unknown"}`.slice(0, 240),
      }),
    });

    await writeWithdrawalLog({
      status: "failed",
      message: error?.message ?? "Withdrawal failed",
    });

    throw error;
  }
}

/** Grouped withdrawal API for runtime callers. */
const runtimeWithdrawal = {
  limits: {
    getExecutionAmountUsdt: getExecutionAmountUSDT,
    maxManualWithdrawUsdt: MAX_MANUAL_WITHDRAW_USDT,
  },
  schedules: {
    execute: executeSchedule,
  },
} as const;

export default runtimeWithdrawal;
export { runtimeWithdrawal };
