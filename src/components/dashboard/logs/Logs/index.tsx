"use client";

import { Stack } from "@mui/material";

import ConfigLogTable from "./ConfigLogTable";
import { ErrorLogs } from "./ErrorLogs";
import LogSection from "./LogSection";
import ManagementLogTable from "./ManagementLogTable";
import SafeHavenLogTable from "./SafeHavenLogTable";
import WithdrawalLogTable from "./WithdrawalLogTable";

export { ErrorLogs } from "./ErrorLogs";

export function SafeHavenLogs() {
  return (
    <LogSection
      kind="safe_haven"
      title="Safe Haven Logs"
      renderTable={(params) => <SafeHavenLogTable {...params} />}
    />
  );
}

export function ManagementLogs() {
  return (
    <LogSection
      kind="management"
      title="Coin Management Logs"
      renderTable={(params) => <ManagementLogTable {...params} />}
    />
  );
}

export function ConfigLogs() {
  return (
    <LogSection
      kind="config"
      title="Config Change Logs"
      renderTable={(params) => <ConfigLogTable {...params} />}
    />
  );
}

export function WithdrawalLogs() {
  return (
    <LogSection
      kind="withdrawals"
      title="Withdrawal Logs"
      renderTable={(params) => <WithdrawalLogTable {...params} />}
    />
  );
}

export default function LogsPanel() {
  return (
    <Stack spacing={2}>
      <ErrorLogs />
      <ManagementLogs />
      <ConfigLogs />
      <SafeHavenLogs />
      <WithdrawalLogs />
    </Stack>
  );
}
