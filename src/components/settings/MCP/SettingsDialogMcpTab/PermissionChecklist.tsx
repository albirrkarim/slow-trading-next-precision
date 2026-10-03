"use client";

import {
  Box,
  Checkbox,
  FormControlLabel,
  Tooltip,
} from "@mui/material";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

import { hasPermission, MCP_PERMISSIONS } from "./permissions";

export function PermissionChecklist({
  checked,
  columns,
  disabled = false,
  onToggle,
}: {
  checked: RuntimeMcpPermission[];
  columns: 2 | 3;
  disabled?: boolean;
  onToggle: (permission: RuntimeMcpPermission) => void;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          md: `repeat(${columns}, minmax(0, 1fr))`,
        },
        gap: 0.5,
      }}
    >
      {MCP_PERMISSIONS.map((permission) => (
        <Tooltip
          key={permission.key}
          title={permission.description}
          placement="top"
          arrow
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={hasPermission(
                  checked,
                  permission.key,
                )}
                disabled={disabled}
                size="small"
                onChange={() => onToggle(permission.key)}
              />
            }
            label={permission.label}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
