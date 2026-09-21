"use client";

import BlackSwanSettings from "../Backswan/BlackSwanSettings";
import type { ConfigDraft, ConfigDraftSetter, DashboardState } from "../settings-types";

export default function SettingsDialogBlackSwanTab({
  configDraft,
  dashboardState,
  selectedAccountSlug,
  setConfigDraft,
}: {
  configDraft: ConfigDraft;
  dashboardState: DashboardState;
  selectedAccountSlug?: string;
  setConfigDraft: ConfigDraftSetter;
}) {
  return (
    <BlackSwanSettings
      configDraft={configDraft}
      dashboardState={dashboardState}
      selectedAccountSlug={selectedAccountSlug}
      setConfigDraft={setConfigDraft}
    />
  );
}
