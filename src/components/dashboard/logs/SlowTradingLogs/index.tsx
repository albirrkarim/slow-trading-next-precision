"use client";

import { Stack } from "@mui/material";

import ConfigLogTable from "./ConfigLogTable";
import { SlowTradingErrorLogs } from "./ErrorLogs";
import SlowTradingLogSection from "./LogSection";
import ManagementLogTable from "./ManagementLogTable";
import SafeHavenLogTable from "./SafeHavenLogTable";
import WithdrawalLogTable from "./WithdrawalLogTable";

export { SlowTradingErrorLogs } from "./ErrorLogs";

export function SlowTradingSafeHavenLogs() {
  return (
    <SlowTradingLogSection
      kind="safe_haven"
      title="Safe Haven Logs"
      renderTable={(params) => <SafeHavenLogTable {...params} />}
    />
  );
}

export function SlowTradingManagementLogs() {
  return (
    <SlowTradingLogSection
      kind="management"
      title="Coin Management Logs"
      renderTable={(params) => <ManagementLogTable {...params} />}
    />
  );
}

export function SlowTradingConfigLogs() {
  return (
    <SlowTradingLogSection
      kind="config"
      title="Config Change Logs"
      renderTable={(params) => <ConfigLogTable {...params} />}
    />
  );
}

export function SlowTradingWithdrawalLogs() {
  return (
    <SlowTradingLogSection
      kind="withdrawals"
      title="Withdrawal Logs"
      renderTable={(params) => <WithdrawalLogTable {...params} />}
    />
  );
}

export default function SlowTradingLogsPanel() {
  return (
    <Stack spacing={2}>
      <SlowTradingErrorLogs />
      <SlowTradingManagementLogs />
      <SlowTradingConfigLogs />
      <SlowTradingSafeHavenLogs />
      <SlowTradingWithdrawalLogs />
    </Stack>
  );
}
