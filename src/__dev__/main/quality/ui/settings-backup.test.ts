import { describe, expect, it } from "vitest";

import {
  parseConfigBackup,
  stringifyConfigBackup,
} from "@/components/settings/Backup/SettingsDialogBackupTab";
import type { ConfigDraft } from "@/components/settings/settings-types";

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

  it("keeps current credentials when the backup omits them", () => {
    const backup = JSON.parse(stringifyConfigBackup(configDraft));
    delete backup.accounts[0].credentials;

    const restored = parseConfigBackup(JSON.stringify(backup), configDraft);

    expect(restored.accounts[0].credentials).toEqual({
      apiKey: "secret-key",
      apiSecret: "secret-value",
    });
  });

  it("uses pasted credentials when the backup carries them", () => {
    const backup = JSON.parse(stringifyConfigBackup(configDraft));
    backup.accounts[0].credentials = {
      apiKey: "pasted-key",
      apiSecret: "pasted-secret",
    };

    const restored = parseConfigBackup(JSON.stringify(backup), configDraft);

    expect(restored.accounts[0].credentials).toEqual({
      apiKey: "pasted-key",
      apiSecret: "pasted-secret",
    });
  });

  it("leaves credentials blank for accounts unknown to the draft", () => {
    const backup = JSON.parse(stringifyConfigBackup(configDraft));
    delete backup.accounts[0].credentials;
    backup.accounts.push({ slug: "new-account" });

    const restored = parseConfigBackup(JSON.stringify(backup), configDraft);

    expect(restored.accounts[1].credentials).toEqual({
      apiKey: "",
      apiSecret: "",
    });
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
