import type { ConfigDraft } from "@/components/settings/settings-types";
import blackSwan from "@/lib/system/trading/black-swan";

function upgradeLegacyDefaults(settings: ConfigDraft): ConfigDraft {
  const config = blackSwan.config.normalize(settings.management.blackSwan);
  const legacyDefaults =
    config.btcWarning.fiveMinuteDrawdownPct === 4 &&
    config.btcWarning.fifteenMinuteDrawdownPct === 6 &&
    config.btcHardTrigger.fiveMinuteDrawdownPct === 8 &&
    config.btcHardTrigger.fifteenMinuteDrawdownPct === 10 &&
    config.btcHardTrigger.sixtyMinuteDrawdownPct === 14 &&
    config.breadthConfirmation.windowMinutes === 5 &&
    config.breadthConfirmation.altDrawdownPct === 8 &&
    config.breadthConfirmation.affectedSymbolsPct === 50 &&
    config.breadthConfirmation.minimumValidSymbols === 5;
  if (!legacyDefaults) return settings;

  return {
    ...settings,
    management: {
      ...settings.management,
      blackSwan: {
        ...config,
        btcWarning: { ...blackSwan.config.defaults.btcWarning },
        breadthConfirmation: {
          ...config.breadthConfirmation,
          minimumValidSymbols:
            blackSwan.config.defaults.breadthConfirmation.minimumValidSymbols,
        },
      },
    },
  };
}

const backtestBlackSwanConfig = { upgradeLegacyDefaults } as const;

export default backtestBlackSwanConfig;
