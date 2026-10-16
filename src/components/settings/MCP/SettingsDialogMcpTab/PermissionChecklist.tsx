"use client";

import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { RuntimeMcpPermission } from "@/lib/system/runtime";

import {
  hasPermission,
  isReadPermission,
  MCP_PERMISSION_GROUPS,
  MCP_PERMISSION_PRESETS,
  MCP_PERMISSIONS,
  samePermissions,
} from "./permissions";

/** Permission checkboxes grouped by area, with one-click presets. Write permissions are marked. */
export function PermissionChecklist({
  checked,
  disabled = false,
  onChange,
}: {
  checked: RuntimeMcpPermission[];
  disabled?: boolean;
  onChange: (permissions: RuntimeMcpPermission[]) => void;
}) {
  const toggle = (permission: RuntimeMcpPermission) =>
    onChange(
      hasPermission(checked, permission)
        ? checked.filter((item) => item !== permission)
        : [...checked, permission],
    );

  return (
    <Stack spacing={1.25}>
      <Stack alignItems="center" direction="row" flexWrap="wrap" gap={0.75}>
        <Typography color="text.secondary" variant="caption">
          Presets
        </Typography>
        {MCP_PERMISSION_PRESETS.map((preset) => {
          const active = samePermissions(checked, preset.permissions);
          return (
            <Chip
              color={active ? "primary" : "default"}
              disabled={disabled}
              key={preset.label}
              label={preset.label}
              onClick={() => onChange(preset.permissions)}
              size="small"
              variant={active ? "filled" : "outlined"}
            />
          );
        })}
        <Typography color="text.secondary" sx={{ ml: "auto" }} variant="caption">
          {checked.length} of {MCP_PERMISSIONS.length} allowed
        </Typography>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        {MCP_PERMISSION_GROUPS.map((group) => (
          <Box key={group.label}>
            <Typography
              color="text.secondary"
              sx={{ display: "block", fontWeight: 700, letterSpacing: 0.4, mb: 0.25, textTransform: "uppercase" }}
              variant="caption"
            >
              {group.label}
            </Typography>
            {group.keys.map((key) => {
              const permission = MCP_PERMISSIONS.find((item) => item.key === key);
              if (!permission) return null;
              return (
                <Tooltip arrow key={key} placement="top-start" title={permission.description}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={hasPermission(checked, key)}
                        disabled={disabled}
                        onChange={() => toggle(key)}
                        size="small"
                        sx={{ py: 0.25 }}
                      />
                    }
                    label={
                      <Stack alignItems="center" direction="row" spacing={0.75}>
                        <Typography variant="body2">{permission.label}</Typography>
                        {!isReadPermission(key) && (
                          <Chip
                            color="warning"
                            label="can change data"
                            size="small"
                            sx={{ fontSize: "0.65rem", height: 18 }}
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    }
                    sx={{ display: "flex", m: 0 }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
