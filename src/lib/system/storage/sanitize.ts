const SECRET_PATH_SEGMENT =
  /token|secret|password|api.?key|chat.?id|private|credential/i;
const MASKED_VALUE = "••••••";

/** Checks whether any config path segment names a credential to mask. */
function isSensitivePath(path: string): boolean {
  return path.split(".").some((segment) => SECRET_PATH_SEGMENT.test(segment));
}

/** Replaces credential values anywhere inside a stored config value. */
function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_PATH_SEGMENT.test(key) ? MASKED_VALUE : maskSecrets(entry),
      ]),
    );
  }
  return value;
}

/**
 * Removes credential keys anywhere inside a stored config value. Unlike
 * masking, removal keeps paste-restore safe — a saved config carries no
 * placeholder that would overwrite live credentials.
 */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_PATH_SEGMENT.test(key))
        .map(([key, entry]) => [key, stripSecrets(entry)]),
    );
  }
  return value;
}

/** Shared credential masking for values persisted to disk or logs. */
const sanitize = {
  isSensitivePath,
  maskSecrets,
  stripSecrets,
  MASKED_VALUE,
} as const;

export default sanitize;
