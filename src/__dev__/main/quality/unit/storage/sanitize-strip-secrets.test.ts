import { describe, expect, it } from "vitest";

import sanitize from "@/lib/system/storage/sanitize";

describe("sanitize.stripSecrets", () => {
  it("removes credential keys at any depth, keeping siblings", () => {
    const stripped = sanitize.stripSecrets({
      range: "6month",
      accounts: [
        { name: "main", balance: 350, apiKey: "K1", apiSecret: "S1" },
        { name: "hedge", balance: 500, credentials: { key: "x" } },
      ],
      exchange: { apiToken: "tok", symbol: "MON" },
    }) as Record<string, unknown>;

    const accounts = stripped.accounts as Record<string, unknown>[];
    expect(accounts[0]).toEqual({ name: "main", balance: 350 });
    expect(accounts[1]).toEqual({ name: "hedge", balance: 500 });
    expect(stripped.exchange).toEqual({ symbol: "MON" });
    expect(JSON.stringify(stripped)).not.toMatch(/K1|S1|tok/);
  });

  it("passes primitives and non-object values through unchanged", () => {
    expect(sanitize.stripSecrets("plain")).toBe("plain");
    expect(sanitize.stripSecrets(42)).toBe(42);
    expect(sanitize.stripSecrets(null)).toBeNull();
    expect(sanitize.stripSecrets([1, "apiKey", true])).toEqual([
      1,
      "apiKey",
      true,
    ]);
  });
});
