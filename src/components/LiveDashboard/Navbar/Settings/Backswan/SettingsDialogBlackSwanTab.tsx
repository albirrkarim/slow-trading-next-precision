"use client";

import BlackSwanSettings from "../Backswan/BlackSwanSettings";
import type { ConfigDraft, ConfigDraftSetter, DashboardState } from "../settings-types";

export default function SettingsDialogBlackSwanTab({
  configDraft,
  dashboardState,
  setConfigDraft,
}: {
  configDraft: ConfigDraft;
  dashboardState: DashboardState;
  setConfigDraft: ConfigDraftSetter;
}) {
  return (
    <BlackSwanSettings
      configDraft={configDraft}
      dashboardState={dashboardState}
      setConfigDraft={setConfigDraft}
    />
  );
}
