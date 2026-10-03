import type { RuntimeMcpPermission } from "@/lib/system/runtime";

export const MCP_PERMISSIONS: Array<{
  key: RuntimeMcpPermission;
  label: string;
  description: string;
}> = [
    {
      key: "tags.read",
      label: "Tags read",
      description: "List tag definitions, descriptions, filters, and assignments.",
    },
    {
      key: "tags.write",
      label: "Tags write",
      description: "Create, update, and delete reusable tags.",
    },
    {
      key: "coin_metadata.read",
      label: "Coin metadata read",
      description: "Read coin descriptions and tag attachments.",
    },
    {
      key: "coin_metadata.write",
      label: "Coin metadata write",
      description: "Edit descriptions and tag attachments.",
    },
    {
      key: "coin_metadata.broadcast",
      label: "Metadata broadcast",
      description: "Manually broadcast metadata to peer instances.",
    },
    {
      key: "balance.read",
      label: "Balance read",
      description:
        "Read available, spendable, reserved, Safe Haven, locked, and total balance values with their meanings.",
    },
    {
      key: "trade_history.read",
      label: "Trade history read",
      description: "Read closed history and open positions.",
    },
    {
      key: "monitoring.read",
      label: "Monitoring read",
      description:
        "Read the credential-free monitoring snapshot: config, schedules, and operational logs.",
    },
    {
      key: "engine_state.read",
      label: "Engine state read",
      description:
        "Read the live runtime engine memory: positions, mark prices, and volatility-point usage markers.",
    },
  ];

export function hasPermission(
  permissions: RuntimeMcpPermission[],
  permission: RuntimeMcpPermission,
) {
  return permissions.includes(permission);
}

export function togglePermission(
  permissions: RuntimeMcpPermission[],
  permission: RuntimeMcpPermission,
) {
  return hasPermission(permissions, permission)
    ? permissions.filter((item) => item !== permission)
    : [...permissions, permission];
}

export function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}
