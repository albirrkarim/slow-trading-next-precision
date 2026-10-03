import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import runtimeAccounts from "@/lib/system/runtime/accounts";
import runtimeCredentials from "@/lib/system/runtime/credentials";
import { FILES } from "@/lib/system/storage/paths";
import { runtimeStorage } from "@/lib/system/storage";

const ENV_KEYS = [
  "ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET",
  "MCP_TOKEN_ENCRYPTION_SECRET",
  "DASHBOARD_PIN",
] as const;

const TEST_SECRET = "account-credentials-test-secret";

describe("account credentials encryption at rest", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("round-trips every credential field through the v1 envelope", () => {
    const encrypted = runtimeCredentials.encryptRecord({
      apiKey: "key-1",
      apiSecret: "secret-1",
      passphrase: "pass-1",
    });

    for (const value of Object.values(encrypted)) {
      expect(value).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    }
    expect(encrypted.apiSecret).not.toContain("secret-1");

    expect(runtimeCredentials.decryptRecord(encrypted)).toEqual({
      apiKey: "key-1",
      apiSecret: "secret-1",
      passphrase: "pass-1",
    });
  });

  it("re-encrypts with a fresh IV so identical input yields different envelopes", () => {
    const first = runtimeCredentials.encryptRecord({
      apiKey: "k",
      apiSecret: "same-secret",
    });
    const second = runtimeCredentials.encryptRecord({
      apiKey: "k",
      apiSecret: "same-secret",
    });

    expect(first.apiSecret).not.toBe(second.apiSecret);
    expect(runtimeCredentials.decryptRecord(second)).toMatchObject({
      apiSecret: "same-secret",
    });
  });

  it("keeps empty fields empty instead of storing ciphertext noise", () => {
    const encrypted = runtimeCredentials.encryptRecord({
      apiKey: "",
      apiSecret: "",
    });

    expect(encrypted).toEqual({ apiKey: "", apiSecret: "" });
    expect(runtimeCredentials.isEncrypted(encrypted.apiKey)).toBe(false);
  });

  it("is idempotent — encrypting an envelope does not double-wrap it", () => {
    const once = runtimeCredentials.encryptRecord({
      apiKey: "k",
      apiSecret: "s",
    });
    const twice = runtimeCredentials.encryptRecord(once);

    expect(twice.apiSecret).toBe(once.apiSecret);
    expect(runtimeCredentials.decryptRecord(twice)).toMatchObject({
      apiSecret: "s",
    });
  });

  it("passes plaintext through decrypt so legacy files keep loading", () => {
    const legacy = { apiKey: "legacy-key", apiSecret: "legacy-secret" };

    expect(runtimeCredentials.decryptRecord(legacy)).toEqual(legacy);
  });

  it("returns empty fields when the decryption secret is wrong", () => {
    const encrypted = runtimeCredentials.encryptRecord({
      apiKey: "key-1",
      apiSecret: "secret-1",
    });

    process.env.ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET = "different-secret";
    expect(runtimeCredentials.decryptRecord(encrypted)).toMatchObject({
      apiKey: "",
      apiSecret: "",
    });
  });

  it("normalizes envelope input to plaintext (accounts.save migration path)", () => {
    const encrypted = runtimeCredentials.encryptRecord({
      apiKey: "key-1",
      apiSecret: "secret-1",
    });

    const [account] = runtimeAccounts.normalize({
      accounts: [
        {
          credentials: encrypted,
          name: "Main",
          slug: "main",
        },
      ],
    });

    expect(account.credentials).toEqual({
      apiKey: "key-1",
      apiSecret: "secret-1",
    });
  });

  it("stores envelopes in accounts.json while in-memory stays plaintext", async () => {
    await runtimeStorage.catalog.accounts.save([
      {
        credentials: {
          apiKey: "disk-key",
          apiSecret: "disk-secret",
          passphrase: "disk-pass",
        },
        name: "Disk Main",
        slug: "disk-main",
      } as never,
    ]);

    const raw = (await fs.readJSON(FILES.prod.accounts)) as {
      accounts: { credentials: Record<string, string> }[];
    };
    const stored = raw.accounts.find(
      (account) => (account as { slug?: string }).slug === "disk-main",
    );
    expect(stored?.credentials.apiSecret).toMatch(/^v1:/);
    expect(JSON.stringify(raw)).not.toContain("disk-secret");

    const listed = await runtimeStorage.catalog.accounts.list();
    const loaded = listed.find((account) => account.slug === "disk-main");
    expect(loaded?.credentials).toEqual({
      apiKey: "disk-key",
      apiSecret: "disk-secret",
      passphrase: "disk-pass",
    });
  });

  it("keeps plaintext on disk when no encryption secret is configured", async () => {
    delete process.env.ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET;

    await runtimeStorage.catalog.accounts.save([
      {
        credentials: { apiKey: "plain-key", apiSecret: "plain-secret" },
        name: "Plain Main",
        slug: "plain-main",
      } as never,
    ]);

    const raw = (await fs.readJSON(FILES.prod.accounts)) as {
      accounts: { slug: string; credentials: Record<string, string> }[];
    };
    const stored = raw.accounts.find((account) => account.slug === "plain-main");
    expect(stored?.credentials.apiSecret).toBe("plain-secret");
  });
});
