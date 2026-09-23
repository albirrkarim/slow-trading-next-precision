import crypto from "node:crypto";

import { runtimeStorage } from "../storage";
import type {
  RuntimeMcpPermission,
  RuntimeMcpPublicTokenRecord,
  RuntimeMcpTokenRecord,
} from "../runtime/types";
import {
  RUNTIME_MCP_PERMISSIONS,
  type RuntimeMcpAuthenticatedToken,
} from "./types";

const PERMISSION_SET = new Set<string>(RUNTIME_MCP_PERMISSIONS);
const TOKEN_SECRET_ENCRYPTION_VERSION = "v1";

function createTokenId() {
  return crypto.randomUUID();
}

function createRawToken() {
  return `slow_mcp_${crypto.randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getTokenSecretEncryptionKey() {
  const secret = String(
    process.env.MCP_TOKEN_ENCRYPTION_SECRET ??
      process.env.DASHBOARD_PIN ??
      "",
  ).trim();
  if (!secret) {
    throw new Error(
      "MCP_TOKEN_ENCRYPTION_SECRET or DASHBOARD_PIN is required to save revealable MCP tokens.",
    );
  }

  return crypto
    .createHash("sha256")
    .update(
      `slow-trading-mcp-token:${secret}:${process.env.DASHBOARD_PIN_SALT ?? ""}`,
    )
    .digest();
}

/** Encrypts an MCP token secret so settings can reveal it again without storing plaintext. */
function encryptTokenSecret(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getTokenSecretEncryptionKey(),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_SECRET_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/** Decrypts a saved MCP token secret for authenticated settings reveal. */
function decryptTokenSecret(encryptedToken: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = encryptedToken.split(":");
  if (
    version !== TOKEN_SECRET_ENCRYPTION_VERSION ||
    !ivRaw ||
    !tagRaw ||
    !encryptedRaw
  ) {
    throw new Error("MCP token secret is not revealable.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getTokenSecretEncryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function safeEqualHash(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizePermissionsInput(value: unknown): RuntimeMcpPermission[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((permission) => String(permission))
        .filter((permission): permission is RuntimeMcpPermission =>
          PERMISSION_SET.has(permission),
        ),
    ),
  );
}

function toPublicToken(
  token: RuntimeMcpTokenRecord,
): RuntimeMcpPublicTokenRecord {
  const {
    tokenHash: _tokenHash,
    tokenSecretEncrypted: _tokenSecretEncrypted,
    ...publicToken
  } = token;
  return {
    ...publicToken,
    secretAvailable: Boolean(token.tokenSecretEncrypted),
  };
}

async function loadTokens(): Promise<RuntimeMcpTokenRecord[]> {
  const catalog = await runtimeStorage.catalog.ensure();
  return catalog.config.runtime.mcp?.tokens ?? [];
}

async function saveTokens(tokens: RuntimeMcpTokenRecord[]) {
  const catalog = await runtimeStorage.catalog.update({
    mcp: {
      tokens,
    },
  });
  return catalog.config.runtime.mcp?.tokens ?? [];
}

async function listTokens() {
  return (await loadTokens()).map(toPublicToken);
}

/** Creates a hashed MCP token and returns the raw secret exactly once. */
async function createToken(params: {
  name: string;
  permissions: RuntimeMcpPermission[];
}) {
  const rawToken = createRawToken();
  const token: RuntimeMcpTokenRecord = {
    id: createTokenId(),
    name: params.name.trim().slice(0, 80) || "MCP token",
    enabled: true,
    permissions: normalizePermissionsInput(params.permissions),
    tokenHash: hashToken(rawToken),
    tokenSecretEncrypted: encryptTokenSecret(rawToken),
    createdAt: Date.now(),
  };
  const tokens = await saveTokens([...(await loadTokens()), token]);

  return {
    token: rawToken,
    record: toPublicToken(tokens.find((item) => item.id === token.id) ?? token),
  };
}

async function updateToken(params: {
  id: string;
  name?: string;
  enabled?: boolean;
  permissions?: RuntimeMcpPermission[];
}) {
  const tokens = await loadTokens();
  let found = false;
  const nextTokens = tokens.map((token) => {
    if (token.id !== params.id) return token;
    found = true;
    return {
      ...token,
      name:
        params.name === undefined
          ? token.name
          : params.name.trim().slice(0, 80) || "MCP token",
      enabled:
        typeof params.enabled === "boolean" ? params.enabled : token.enabled,
      permissions:
        params.permissions === undefined
          ? token.permissions
          : normalizePermissionsInput(params.permissions),
    };
  });
  if (!found) throw new Error("MCP token not found");
  return (await saveTokens(nextTokens)).map(toPublicToken);
}

async function deleteToken(id: string) {
  const tokens = await loadTokens();
  const nextTokens = tokens.filter((token) => token.id !== id);
  if (nextTokens.length === tokens.length) {
    throw new Error("MCP token not found");
  }
  return (await saveTokens(nextTokens)).map(toPublicToken);
}

async function revealToken(id: string) {
  const token = (await loadTokens()).find((item) => item.id === id);
  if (!token) throw new Error("MCP token not found");
  return decryptTokenSecret(token.tokenSecretEncrypted);
}

async function authenticateToken(
  rawToken: string,
): Promise<RuntimeMcpAuthenticatedToken | null> {
  // PROD:MCP_SYNC_TOKEN_SUPER_USER
  const tokenHash = hashToken(rawToken);
  const syncToken = String(process.env.SYNC_TOKEN ?? "").trim();
  if (syncToken && safeEqualHash(tokenHash, hashToken(syncToken))) {
    const token: RuntimeMcpTokenRecord = {
      id: "sync-token-super-user",
      name: "SYNC_TOKEN super user",
      enabled: true,
      permissions: [...RUNTIME_MCP_PERMISSIONS],
      tokenHash,
      tokenSecretEncrypted: "",
      createdAt: 0,
    };
    return {
      token,
      permissions: new Set(RUNTIME_MCP_PERMISSIONS),
    } satisfies RuntimeMcpAuthenticatedToken;
  }
  const tokens = await loadTokens();
  const token = tokens.find(
    (item) =>
      item.enabled &&
      item.tokenHash.length === tokenHash.length &&
      safeEqualHash(item.tokenHash, tokenHash),
  );

  if (!token) return null;

  const touchedTokens = tokens.map((item) =>
    item.id === token.id ? { ...item, lastUsedAt: Date.now() } : item,
  );
  await saveTokens(touchedTokens);

  return {
    token,
    permissions: new Set(token.permissions),
  } satisfies RuntimeMcpAuthenticatedToken;
}

function assertPermission(
  auth: RuntimeMcpAuthenticatedToken,
  permission: RuntimeMcpPermission,
) {
  if (!auth.permissions.has(permission)) {
    throw new Error(`MCP token is missing permission: ${permission}`);
  }
}

const runtimeMcpTokens = {
  assertPermission,
  authenticate: authenticateToken,
  create: createToken,
  delete: deleteToken,
  list: listTokens,
  reveal: revealToken,
  update: updateToken,
} as const;

export default runtimeMcpTokens;
