import { systemLog } from "@/lib/system/logging";
import { systemNotif } from "@/lib/system/notification";

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
const lastAlertAtByKey = new Map<string, number>();

function getCooldownMs(): number {
  const raw = process.env.BINANCE_BALANCE_ALERT_COOLDOWN_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_COOLDOWN_MS;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COOLDOWN_MS;
}

export function formatBinanceBalanceError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function notifyBinanceBalanceFailure(params: {
  symbol: string;
  tradingMode: string;
  reason: string;
}): void {
  const key = `${params.tradingMode}:${params.symbol}`;
  const now = Date.now();
  const lastAlertAt = lastAlertAtByKey.get(key) ?? 0;

  if (now - lastAlertAt < getCooldownMs()) {
    return;
  }

  lastAlertAtByKey.set(key, now);

  void systemNotif
    .central({
      dashboard: "SLOW",
      key: "NOTIF_ERROR",
      dedupeKey: `binance-balance-failure:${key}`,
      title: "Binance balance check failed",
      message: [
        `System can't fetch Binance balance for ${params.symbol}.`,
        `Trading mode: ${params.tradingMode}`,
        `Reason: ${params.reason}`,
        "",
        "Please check Binance API key permissions and IP restriction whitelist. If the server/VPS IP changed, update the Binance allowed IP list.",
      ].join("\n"),
    })
    .catch((error) => {
      systemLog.error("Failed to send Binance balance failure notification:", error);
    });
}
