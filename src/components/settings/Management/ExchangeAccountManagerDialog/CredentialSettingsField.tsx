"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  InputAdornment,
  TextField,
} from "@mui/material";
import IconButtonTooltip from "@/components/ui/IconButtonTooltip";

import { maskCredentialValue } from "./utils";

export function CredentialSettingsField({
  info,
  label,
  onBlur,
  onChange,
  revealed,
  setRevealed,
  value,
}: {
  info: string;
  label: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
  value: string;
}) {
  const editable = revealed || value.length === 0;

  return (
    <TextField
      label={label}
      size="small"
      fullWidth
      value={editable ? value : maskCredentialValue(value)}
      onFocus={() => {
        if (!revealed && value.length === 0) {
          setRevealed(true);
        }
      }}
      onChange={(event) => {
        if (editable) {
          if (!revealed) {
            setRevealed(true);
          }
          onChange(event.target.value);
        }
      }}
      onBlur={onBlur}
      slotProps={{
        input: {
          readOnly: !editable,
          endAdornment: (
            <InputAdornment position="end">
              <IconButtonTooltip
                edge="end"
                size="small"
                onClick={() => setRevealed(!revealed)}
                tooltipTitle={revealed ? "Hide value" : "Show value"}
              >
                {revealed ? (
                  <VisibilityOffIcon fontSize="inherit" />
                ) : (
                  <VisibilityIcon fontSize="inherit" />
                )}
              </IconButtonTooltip>
              <IconButtonTooltip
                edge="end"
                size="small"
                sx={{ color: "text.secondary" }}
                tooltipTitle={info}
              >
                <HelpOutlineIcon fontSize="inherit" />
              </IconButtonTooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
