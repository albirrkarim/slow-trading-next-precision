import type {
  RuntimeConfigLogEntry,
  RuntimeLogKind,
  RuntimeManagementLogEntry,
  RuntimeSafeHavenLogEntry,
  RuntimeWithdrawalLogEntry,
} from "@/lib/system/storage";

export type LogEntryByKind = {
  config: RuntimeConfigLogEntry;
  management: RuntimeManagementLogEntry;
  safe_haven: RuntimeSafeHavenLogEntry;
  withdrawals: RuntimeWithdrawalLogEntry;
};

export type GenericLogKind = Exclude<RuntimeLogKind, "errors">;
