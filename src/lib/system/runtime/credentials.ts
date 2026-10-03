import crypto from "node:crypto";

import systemLog from "../logging";
import type { RuntimeAccountCredentials } from "./types";

const ENCRYPTION_VERSION = "v1";
const ENVELOPE_PART_COUNT = 4;

let warnedMissingKey = false;
let warnedDecryptFailure = false;

/**
 * AES-256-GCM key for exchange credentials at rest, domain-separated from
 * the MCP token key. Prefers a dedicated secret so rotating DASHBOARD_PIN
 * does not break stored credentials.
 */
function getEncryptionKey(): Buffer | null {
  const secret = String(
    process.env.ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET ??
      process.env.MCP_TOKEN_ENCRYPTION_SECRET ??
      process.env.DASHBOARD_PIN ??
      "",
  ).trim();
  if (!secret) return null;

  return crypto
    .createHash("sha256")
    .update(
      `account-credentials:${secret}:${process.env.DASHBOARD_PIN_SALT ?? ""}`,
    )
    .digest();
}

/** Envelope check: `v1:<iv>:<tag>:<ct>` — real exchange keys never contain `:`. */
function isEncryptedField(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  return (
    parts.length === ENVELOPE_PART_COUNT &&
    parts[0] === ENCRYPTION_VERSION &&
    parts.slice(1).every(Boolean)
  );
}

function encryptField(value: string, key: Buffer): string {
  if (!value || isEncryptedField(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function warnDecryptFailure(reason: string) {
  if (warnedDecryptFailure) return;
  warnedDecryptFailure = true;
  systemLog.error(
    `Cannot decrypt account credentials (${reason}); ` +
      "set ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET to the value used when they " +
      "were saved, or re-enter them in settings.",
  );
}

/**
 * Decrypts one stored credential field. Plaintext values pass through so
 * pre-encryption files keep loading; envelopes that cannot be decrypted
 * (missing or wrong key) resolve to "" so the account fails visibly on the
 * next exchange call instead of trading with ciphertext.
 */
function decryptField(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isEncryptedField(raw)) return raw;

  const key = getEncryptionKey();
  if (!key) {
    warnDecryptFailure("no encryption secret configured");
    return "";
  }

  const [version, ivRaw, tagRaw, encryptedRaw] = raw.split(":");
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    warnDecryptFailure(`unsupported envelope ${version}`);
    return "";
  }
}

/**
 * Decrypts a raw persisted credentials object, preserving its shape.
 * Unknown input passes through untouched.
 */
function decryptRecord(credentials: unknown): unknown {
  if (!credentials || typeof credentials !== "object") return credentials;
  const record = credentials as Record<string, unknown>;

  return {
    ...record,
    apiKey: decryptField(record.apiKey),
    apiSecret: decryptField(record.apiSecret),
    ...(typeof record.passphrase === "string" && record.passphrase
      ? { passphrase: decryptField(record.passphrase) }
      : {}),
  };
}

/**
 * Encrypts credential fields for persistence. Without any encryption secret
 * the record is returned unchanged (local dev without a PIN keeps today's
 * plaintext behavior, warned once per process).
 */
function encryptRecord(
  credentials: RuntimeAccountCredentials,
): RuntimeAccountCredentials {
  const key = getEncryptionKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      systemLog.warn(
        "Account credentials stored without encryption: " +
          "set ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET (or DASHBOARD_PIN).",
      );
    }
    return credentials;
  }

  return {
    apiKey: encryptField(credentials.apiKey, key),
    apiSecret: encryptField(credentials.apiSecret, key),
    ...(credentials.passphrase
      ? { passphrase: encryptField(credentials.passphrase, key) }
      : {}),
  };
}

/** Grouped helpers for encrypting account credentials at the disk boundary. */
const runtimeCredentials = {
  decryptField,
  decryptRecord,
  encryptRecord,
  isEncrypted: isEncryptedField,
} as const;

export default runtimeCredentials;
export { runtimeCredentials };
