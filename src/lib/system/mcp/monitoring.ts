import runtimeAccountConfig from "../runtime/account-config";
import type { RuntimeConfig } from "../runtime/types";
import { runtimeLogs, runtimeStorage } from "../storage";
import type { RuntimeLogs } from "../storage/logs";
import type { RuntimeMode } from "../storage/runtime";

type MonitoringSection = "config" | "automation" | "logs";

export interface RuntimeMonitoringSnapshotInput {
  mode?: "active" | RuntimeMode;
  include?: MonitoringSection[];
  logLimit?: number;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function iso(timestamp?: number): string | null {
  return timestamp && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function requestedSections(value: unknown): Set<MonitoringSection> {
  if (!Array.isArray(value)) return new Set(["config", "automation"]);
  return new Set(
    value.filter(
      (item): item is MonitoringSection =>
        item === "config" || item === "automation" || item === "logs",
    ),
  );
}

function secretValues(config: RuntimeConfig): string[] {
  return config.accounts.flatMap((account) =>
    Object.values(account.credentials ?? {}).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
}

function scrubText(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => result.split(secret).join("[REDACTED]"),
    value,
  );
}

function boundedLogs(
  logs: RuntimeLogs,
  limit: number,
  secrets: readonly string[],
) {
  return {
    binanceCooldowns: (logs.binanceCooldowns ?? []).slice(0, limit).map((entry) => ({
      id: entry.id,
      startAt: iso(entry.t),
      endAt: iso(entry.end),
      banEndAt: iso(entry.banEnd),
      settleMs: entry.settle ?? null,
      endpoint: entry.endpoint,
      kind: entry.kind,
      occurrences: entry.occurrences,
      code: entry.code ?? null,
      httpStatus: entry.status ?? null,
      reason: scrubText(entry.reason, secrets),
    })),
    errors: logs.errors.slice(0, limit).map((entry) => ({
      id: entry.id,
      createdAt: iso(entry.createdAt),
      source: entry.source,
      status: entry.status,
      message: scrubText(entry.message, secrets),
    })),
    management: logs.management.slice(0, limit).map((entry) => ({
      id: entry.id,
      createdAt: iso(entry.createdAt),
      action: entry.action,
      symbol: entry.symbol,
      source: entry.source,
      reason: scrubText(entry.reason, secrets),
    })),
    safeHaven: logs.safeHaven.slice(0, limit).map((entry) => ({
      id: entry.id,
      accountId: entry.account,
      createdAt: iso(entry.createdAt),
      mode: entry.mode,
      previousUSDT: entry.previousUSDT,
      nextUSDT: entry.nextUSDT,
      deltaUSDT: entry.deltaUSDT,
      source: entry.source,
      reason: entry.reason ? scrubText(entry.reason, secrets) : null,
    })),
    withdrawals: logs.withdrawals.slice(0, limit).map((entry) => ({
      id: entry.id,
      accountId: entry.account,
      createdAt: iso(entry.createdAt),
      trigger: entry.trigger,
      status: entry.status,
      mode: entry.mode,
      scheduleId: entry.scheduleId,
      scheduleName: entry.scheduleName ?? null,
      amountUSDT: entry.amountUSDT ?? null,
      availableSafeHavenUSDT: entry.availableSafeHavenUSDT ?? null,
      targetNetwork: entry.targetNetwork ?? null,
      targetWalletAddress: entry.targetWalletAddress ?? null,
      message: scrubText(entry.message, secrets),
      withdrawId: entry.withdrawId ?? null,
    })),
  };
}

/** Builds the credential-free monitoring snapshot shared by all SLOW instances. */
async function read(
  input: RuntimeMonitoringSnapshotInput,
  instanceName: string,
) {
  // PROD:MCP_MONITORING_SNAPSHOT
  // PROD:MCP_MONITORING_CREDENTIAL_REDACTION
  // PROD:MCP_MONITORING_EFFECTIVE_CONFIG
  // PROD:MCP_MONITORING_SECTION_FAILURE
  const sections = requestedSections(input.include);
  const catalog = await runtimeStorage.catalog.ensure();
  const activeMode = catalog.mode;
  const requestedMode =
    input.mode === "live" || input.mode === "sandbox" ? input.mode : "active";
  const resolvedMode = requestedMode === "active" ? activeMode : requestedMode;
  const accounts = catalog.config.accounts;
  const secrets = secretValues(catalog.config);
  const issues: Array<{ section: string; code: string; message: string }> = [];
  const effectiveConfigs = sections.has("config")
    ? accounts.map((account) => ({
        id: account.slug,
        config: runtimeAccountConfig.effective(
          catalog.config.management,
          account,
        ),
      }))
    : [];
  let logs: RuntimeLogs | null = null;
  if (sections.has("logs")) {
    try {
      logs = await runtimeLogs.load();
    } catch {
      issues.push({ section: "logs", code: "logs_unavailable", message: "Operational logs are unavailable." });
    }
  }
  const logLimit = Math.min(100, Math.max(1, Number(input.logLimit) || 20));

  return {
    schemaVersion: "1.0" as const,
    generatedAt: new Date().toISOString(),
    status: issues.length ? "partial" as const : "complete" as const,
    issues,
    instance: {
      appName: instanceName,
      profileName: catalog.config.management.name,
      description: catalog.config.management.description,
      accountModel: "multi" as const,
      capabilities: {
        accountOverrides: true,
        sandboxPerAccount: true,
        withdrawalPerAccount: true,
      },
    },
    mode: { requested: requestedMode, active: activeMode, resolved: resolvedMode },
    ...(sections.has("config") && {
      config: {
        shared: cloneJson(catalog.config.management),
        effectiveByAccount: Object.fromEntries(
          effectiveConfigs.map((item) => [item.id, cloneJson(item.config)]),
        ),
      },
    }),
    accounts: accounts.map((account) => ({
      id: account.slug,
      name: account.name,
      description: account.description,
      type: account.type,
      enabled: account.enabled,
      createdAt: iso(account.createdAt),
      updatedAt: iso(account.updatedAt),
      activeMode,
      sandbox: cloneJson(account.sandbox),
      credentialStatus: {
        configured: Boolean(account.credentials?.apiKey && account.credentials?.apiSecret),
      },
    })),
    ...(sections.has("automation") && {
      automation: {
        withdrawals: {
          autoEnabled: catalog.config.runtime.withdrawal?.autoEnabled ?? false,
          wallets: (catalog.config.runtime.withdrawal?.walletBook ?? []).map((wallet) => ({
            id: wallet.id,
            name: wallet.name,
            network: wallet.network,
            address: wallet.address,
          })),
          schedules: (catalog.config.runtime.withdrawal?.schedules ?? []).map((schedule) => ({
            id: schedule.id,
            accountId: schedule.account,
            name: schedule.name,
            enabled: schedule.enabled,
            amountUSDT: schedule.amountUSDT,
            dayOfMonth: schedule.dayOfMonth,
            walletId: schedule.walletId ?? null,
            targetNetwork: schedule.targetNetwork,
            targetWalletAddress: schedule.targetWalletAddress,
            lastAttemptAt: iso(schedule.lastAttemptAt),
            lastSuccessAt: iso(schedule.lastSuccessAt),
            lastQueuedAt: iso(schedule.lastQueuedAt),
            lastStatus: schedule.lastStatus ?? null,
          })),
        },
        safeHaven: {
          autoEnabled: catalog.config.runtime.safeHaven?.autoEnabled ?? false,
          schedules: (catalog.config.runtime.safeHaven?.schedules ?? []).map((schedule) => ({
            id: schedule.id,
            accountId: null,
            name: schedule.name,
            enabled: schedule.enabled,
            amountUSDT: schedule.amountUSDT,
            pct: schedule.pct,
            dayOfMonth: schedule.dayOfMonth,
            lastQueuedAt: Object.fromEntries(
              Object.entries(schedule.lastQueuedAt ?? {}).map(([mode, time]) => [mode, iso(time)]),
            ),
          })),
        },
      },
    }),
    ...(logs && { logs: boundedLogs(logs, logLimit, secrets) }),
    redaction: {
      policy: "credentials-omitted-v1" as const,
      omitted: [
        "accounts[].credentials",
        "runtime.mcp.tokens[].tokenHash",
        "runtime.mcp.tokens[].tokenSecretEncrypted",
        "error.details",
        "error.stack",
      ],
    },
  };
}

const runtimeMcpMonitoring = { read } as const;

export default runtimeMcpMonitoring;
