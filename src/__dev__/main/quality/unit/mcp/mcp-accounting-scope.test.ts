import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import runtimeMcpAccountScope from "@/lib/system/mcp/account-scope";
import { runtimeStorage } from "@/lib/system/storage";

let tmpRoot: string;

describe("MCP accounting scope", () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-accounting-"));
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
    await runtimeStorage.catalog.ensure();
  });

  afterEach(async () => {
    delete process.env.PERSISTENT_STORAGE_ROOT;
    await fs.remove(tmpRoot);
  });

  it("follows the accounting switch, not the entries switch; unsaved legacy accounts follow their entries switch", async () => {
    const [first] = await runtimeStorage.catalog.accounts.list();
    const { accountingEnabled: _unset, ...legacy } = first;
    await runtimeStorage.catalog.accounts.save([
      { ...first, enabled: false },
      { name: "Experiment", slug: "experiment", accountingEnabled: false },
      { ...legacy, enabled: false, name: "Legacy off", slug: "legacy-off" },
      { ...legacy, name: "Legacy on", slug: "legacy-on" },
    ]);

    const saved = await runtimeStorage.catalog.accounts.list();
    expect(saved.map((account) => [account.slug, account.accountingEnabled])).toEqual([
      [first.slug, true],
      ["experiment", false],
      ["legacy-off", false],
      ["legacy-on", true],
    ]);

    const scope = await runtimeMcpAccountScope.resolve({ defaultMode: "active", requestedMode: "live" });
    expect(scope.accounts.map((account) => account.slug)).toEqual([first.slug, "legacy-on"]);
  });
});
