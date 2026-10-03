import type { McpToolCatalogItem } from "../SettingsDialogMcpToolPreview";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

export interface McpTokenRecord {
  id: string;
  name: string;
  enabled: boolean;
  permissions: RuntimeMcpPermission[];
  secretAvailable: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

export interface McpTokensResponse {
  tools?: McpToolCatalogItem[];
  tokens: McpTokenRecord[];
}

export interface McpCreateResponse {
  token: string;
  record: McpTokenRecord;
}

export interface McpRevealResponse {
  token: string;
}
