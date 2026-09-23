import runtimeCatalog from "@/lib/system/storage/catalog";
import type { RuntimeConfig } from "@/lib/system/runtime/types";
import { describe, expect, it } from "vitest";

describe("catalog diffConfig", () => {
  it("returns no changes for identical configs", () => {
    const config = {
      management: { symbols: ["BTC", "ETH"] },
      runtime: { sandboxEnabled: true },
    } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(config, config)).toEqual([]);
  });

  it("flattens nested changes into leaf paths", () => {
    const previous = {
      runtime: { sandboxEnabled: true, pollMs: 5000 },
      management: { symbols: ["BTC"] },
    } as unknown as RuntimeConfig;
    const next = {
      runtime: { sandboxEnabled: false, pollMs: 5000 },
      management: { symbols: ["BTC", "ETH"] },
    } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([
      {
        path: "management.symbols.1",
        previous: undefined,
        next: "ETH",
      },
      { path: "runtime.sandboxEnabled", previous: true, next: false },
    ]);
  });

  it("diffs array elements by index so changes point at exact paths", () => {
    const previous = {
      accounts: [
        { slug: "1", name: "Main", credentials: { apiKey: "a" } },
        { slug: "2", name: "Second" },
      ],
    } as unknown as RuntimeConfig;
    const next = {
      accounts: [
        { slug: "1", name: "Primary", credentials: { apiKey: "b" } },
        { slug: "2", name: "Second" },
      ],
    } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([
      {
        path: "accounts.0.credentials.apiKey",
        previous: "a",
        next: "b",
      },
      { path: "accounts.0.name", previous: "Main", next: "Primary" },
    ]);
  });

  it("reports added keys with no previous value", () => {
    const previous = { runtime: { pollMs: 5000 } } as unknown as RuntimeConfig;
    const next = {
      runtime: { pollMs: 5000 },
      entry: { enabled: true },
    } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([
      { path: "entry", previous: undefined, next: { enabled: true } },
    ]);
  });

  it("reports removed keys with no next value", () => {
    const previous = {
      runtime: { pollMs: 5000 },
      exit: { enabled: false },
    } as unknown as RuntimeConfig;
    const next = { runtime: { pollMs: 5000 } } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([
      { path: "exit", previous: { enabled: false }, next: undefined },
    ]);
  });

  it("skips bookkeeping timestamps that churn on every save", () => {
    const previous = {
      accounts: [{ slug: "1", name: "Main", updatedAt: 1000 }],
    } as unknown as RuntimeConfig;
    const next = {
      accounts: [{ slug: "1", name: "Main", updatedAt: 2000 }],
    } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([]);
  });

  it("treats object-vs-scalar type changes as leaf changes", () => {
    const previous = {
      notification: { telegram: { enabled: true } },
    } as unknown as RuntimeConfig;
    const next = { notification: "disabled" } as unknown as RuntimeConfig;

    expect(runtimeCatalog.diffConfig(previous, next)).toEqual([
      {
        path: "notification",
        previous: { telegram: { enabled: true } },
        next: "disabled",
      },
    ]);
  });
});
