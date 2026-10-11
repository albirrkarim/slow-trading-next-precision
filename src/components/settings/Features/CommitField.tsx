"use client";

import { TextField, type TextFieldProps } from "@mui/material";
import { useState } from "react";

/**
 * Text field that edits a local draft and commits on blur/Enter only when
 * `parse` accepts it — the config draft never holds an invalid value.
 * A rejected value shows `error` and stays editable until fixed.
 */
export default function CommitField<T>({
  value,
  format = String,
  parse,
  onCommit,
  ...props
}: Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "error"> & {
  value: T;
  format?: (value: T) => string;
  /** Returns the parsed value, or an error message string to reject. */
  parse: (text: string) => { value: T } | { error: string };
  onCommit: (value: T) => void;
}) {
  // Draft text only while editing; otherwise the field mirrors `value`.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const commit = () => {
    if (draft === null) return;
    const result = parse(draft.trim());
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(undefined);
    setDraft(null);
    if (result.value !== value) onCommit(result.value);
  };

  return (
    <TextField
      {...props}
      error={Boolean(error)}
      helperText={error ?? props.helperText}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => event.key === "Enter" && commit()}
      value={draft ?? format(value)}
    />
  );
}
