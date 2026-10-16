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

/** Areas the permission checklist is grouped by, in display order. */
export const MCP_PERMISSION_GROUPS: Array<{
  keys: RuntimeMcpPermission[];
  label: string;
}> = [
  { keys: ["balance.read", "trade_history.read"], label: "Balance & trades" },
  { keys: ["monitoring.read", "engine_state.read"], label: "Monitoring" },
  {
    keys: ["coin_metadata.read", "coin_metadata.write", "coin_metadata.broadcast"],
    label: "Coin metadata",
  },
  { keys: ["tags.read", "tags.write"], label: "Tags" },
];

/** Permissions that only read data; every other permission can change something. */
export function isReadPermission(permission: RuntimeMcpPermission): boolean {
  return permission.endsWith(".read");
}

export const MCP_PERMISSION_PRESETS: Array<{
  label: string;
  permissions: RuntimeMcpPermission[];
}> = [
  {
    label: "Read only",
    permissions: MCP_PERMISSIONS.map((item) => item.key).filter(isReadPermission),
  },
  {
    label: "Full access",
    permissions: MCP_PERMISSIONS.map((item) => item.key),
  },
];

/** Same members regardless of order. */
export function samePermissions(
  left: RuntimeMcpPermission[],
  right: RuntimeMcpPermission[],
): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

/** "3 min ago" style time, or "never". */
export function formatRelative(timestamp?: number, now = Date.now()): string {
  if (!timestamp) return "never";
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

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
