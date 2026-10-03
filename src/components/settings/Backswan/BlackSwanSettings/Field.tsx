"use client";

import SettingsInfoField from "../../Components/SettingsInfoField";

export function Field(props: {
  info: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  integer?: boolean;
}) {
  return (
    <SettingsInfoField
      fullWidth
      info={props.info}
      label={props.label}
      onChange={(event) => props.onChange(Number(event.target.value))}
      size="small"
      slotProps={{
        htmlInput: {
          min: props.integer ? 1 : 0.1,
          step: props.integer ? 1 : 0.1,
        },
      }}
      type="number"
      value={props.value}
    />
  );
}
