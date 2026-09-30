import { describe, expect, it } from "vitest";

import backtestBlackSwanConfig from "@/components/dev/backtest-precision/black-swan-config";
import type { ConfigDraft } from "@/components/settings/settings-types";
import blackSwan from "@/lib/system/trading/black-swan";

const LEGACY_DETECTOR = {
  breadthConfirmation: {
    affectedSymbolsPct: 50,
    altDrawdownPct: 8,
    minimumValidSymbols: 5,
    windowMinutes: 5,
  },
  btcHardTrigger: {
    fifteenMinuteDrawdownPct: 10,
    fiveMinuteDrawdownPct: 8,
    sixtyMinuteDrawdownPct: 14,
  },
  btcWarning: { fifteenMinuteDrawdownPct: 6, fiveMinuteDrawdownPct: 4 },
};

function draftWith(blackSwanConfig: unknown): ConfigDraft {
  return {
    accounts: [{ slug: "acc-1", trading: { entryLegs: "MAIN" } }],
    management: { blackSwan: blackSwanConfig, symbols: ["BTC", "SUI"] },
    runtime: { blackSwanStageIntervalMinutes: 1, runnerEnabled: true },
  } as unknown as ConfigDraft;
}

describe("backtestBlackSwanConfig.upgradeLegacyDefaults", () => {
  it("pins the calibrated defaults", () => {
    expect(blackSwan.config.defaults).toMatchObject({
      breadthConfirmation: {
        affectedSymbolsPct: 50,
        altDrawdownPct: 8,
        minimumValidSymbols: 3,
        windowMinutes: 5,
      },
      btcHardTrigger: {
        fifteenMinuteDrawdownPct: 10,
        fiveMinuteDrawdownPct: 8,
        sixtyMinuteDrawdownPct: 14,
      },
      btcWarning: { fifteenMinuteDrawdownPct: 6, fiveMinuteDrawdownPct: 2.8 },
      enabled: false,
      exitPolicy: "CLOSE_ADVERSE",
      maxDataAgeMinutes: 2,
      recoveryCooldownMinutes: 60,
      requireManualLiveRecovery: true,
    });
  });

  it("upgrades an exact legacy detector preset to the calibrated defaults", () => {
    const draft = draftWith({
      ...LEGACY_DETECTOR,
      enabled: true,
      exitPolicy: "FLATTEN_ALL",
      maxDataAgeMinutes: 3,
      recoveryCooldownMinutes: 45,
      requireManualLiveRecovery: false,
    });

    const upgraded = backtestBlackSwanConfig.upgradeLegacyDefaults(draft);

    expect(upgraded).not.toBe(draft);
    const next = upgraded.management.blackSwan!;
    expect(next.btcWarning).toEqual({
      fifteenMinuteDrawdownPct: 6,
      fiveMinuteDrawdownPct: 2.8,
    });
    expect(next.breadthConfirmation.minimumValidSymbols).toBe(3);
    expect(next.btcHardTrigger).toEqual(LEGACY_DETECTOR.btcHardTrigger);
    expect(next.enabled).toBe(true);
    expect(next.exitPolicy).toBe("FLATTEN_ALL");
    expect(next.maxDataAgeMinutes).toBe(3);
    expect(next.recoveryCooldownMinutes).toBe(45);
    expect(next.requireManualLiveRecovery).toBe(false);
    expect(upgraded.accounts).toBe(draft.accounts);
    expect(upgraded.runtime).toBe(draft.runtime);
    expect(upgraded.management.symbols).toEqual(["BTC", "SUI"]);
  });

  it("does not mutate the input draft", () => {
    const blackSwanConfig = {
      ...LEGACY_DETECTOR,
      enabled: true,
    };
    const draft = draftWith(blackSwanConfig);

    backtestBlackSwanConfig.upgradeLegacyDefaults(draft);

    expect(blackSwanConfig.btcWarning.fiveMinuteDrawdownPct).toBe(4);
    expect(blackSwanConfig.breadthConfirmation.minimumValidSymbols).toBe(5);
  });

  it("is idempotent: a second pass returns the same object", () => {
    const draft = draftWith({ ...LEGACY_DETECTOR, enabled: true });
    const once = backtestBlackSwanConfig.upgradeLegacyDefaults(draft);
    const twice = backtestBlackSwanConfig.upgradeLegacyDefaults(once);

    expect(twice).toBe(once);
    expect(twice.management.blackSwan?.btcWarning.fiveMinuteDrawdownPct).toBe(
      2.8,
    );
  });

  it.each([
    ["custom BTC warning", { btcWarning: { fifteenMinuteDrawdownPct: 6, fiveMinuteDrawdownPct: 3 } }],
    ["custom hard trigger", { btcHardTrigger: { fifteenMinuteDrawdownPct: 10, fiveMinuteDrawdownPct: 9, sixtyMinuteDrawdownPct: 14 } }],
    ["custom breadth", { breadthConfirmation: { affectedSymbolsPct: 50, altDrawdownPct: 8, minimumValidSymbols: 4, windowMinutes: 5 } }],
  ])("leaves %s untouched", (_label, detectorPatch) => {
    const draft = draftWith({ ...LEGACY_DETECTOR, ...detectorPatch });
    expect(backtestBlackSwanConfig.upgradeLegacyDefaults(draft)).toBe(draft);
  });

  it("treats omitted optional fields through normalized defaults", () => {
    const draft = draftWith({
      btcWarning: { fifteenMinuteDrawdownPct: 6, fiveMinuteDrawdownPct: 4 },
      breadthConfirmation: { minimumValidSymbols: 5 },
      enabled: true,
    });

    const upgraded = backtestBlackSwanConfig.upgradeLegacyDefaults(draft);

    expect(upgraded).not.toBe(draft);
    expect(
      upgraded.management.blackSwan?.breadthConfirmation.minimumValidSymbols,
    ).toBe(3);
    expect(
      upgraded.management.blackSwan?.btcWarning.fiveMinuteDrawdownPct,
    ).toBe(2.8);
  });

  it("returns the same object when blackSwan is absent or already current", () => {
    for (const value of [undefined, {}, { enabled: true }]) {
      const draft = draftWith(value);
      expect(backtestBlackSwanConfig.upgradeLegacyDefaults(draft)).toBe(draft);
    }
  });
});
