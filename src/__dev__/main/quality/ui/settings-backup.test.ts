import { describe, expect, it } from "vitest";

import {
  parseConfigBackup,
  stringifyConfigBackup,
} from "@/components/LiveDashboard/Navbar/Settings/Backup/SettingsDialogBackupTab";
import type { ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";

const configDraft = {
  management: {
    name: "Seasonal Trade",
    description: "Backup test",
    symbols: ["AAVE", "ARB"],
    exchangeType: "binance",
    tradingMode: "futures",
    decisionEngineVersion: "decision.v19",
  },
  runtime: {
    exchangeAccountSlug: "account-1",
    runnerEnabled: true,
    autoEntryEnabled: true,
    autoEntryDailyPnlLimitUSDT: -50,
    autoExitEnabled: true,
    entrySignalBypass: false,
    notification: {
      email: { enabled: false, types: [] },
      telegram: { enabled: true, types: [] },
    },
    withdrawal: { autoEnabled: false, schedules: [], walletBook: [] },
    safeHaven: { autoEnabled: false, schedules: [] },
    mcp: { tokens: [] },
  },
  accounts: [
    {
      slug: "account-1",
      credentials: {
        apiKey: "secret-key",
        apiSecret: "secret-value",
      },
    },
  ],
} as unknown as ConfigDraft;

describe("settings config backup", () => {
  it("round-trips the complete settings draft, including credentials", () => {
    const backup = stringifyConfigBackup(configDraft);

    expect(parseConfigBackup(backup)).toEqual(configDraft);
    expect(backup).toContain("secret-value");
  });

  it("rejects invalid or incomplete backups", () => {
    expect(() => parseConfigBackup("not json")).toThrow(
      "The pasted value is not valid JSON.",
    );
    expect(() => parseConfigBackup('{"management":{}}')).toThrow(
      'The backup is missing the required "runtime" field.',
    );
  });

  it("does not accept the old flat backup shape", () => {
    expect(() =>
      parseConfigBackup(JSON.stringify({ name: "Legacy flat config" })),
    ).toThrow('The backup is missing the required "management" field.');
  });
});
