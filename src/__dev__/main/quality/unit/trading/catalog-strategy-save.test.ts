import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runtimeStorage } from "@/lib/system/storage";

let tmpRoot: string;

describe("catalog strategy save", () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-strategy-"));
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
    await runtimeStorage.catalog.ensure();
  });

  afterEach(async () => {
    delete process.env.PERSISTENT_STORAGE_ROOT;
    await fs.remove(tmpRoot);
  });

  it("switches strategies, clears to the default pipeline with \"\", and keeps it when the key is absent", async () => {
    await runtimeStorage.catalog.update({ config: { strategy: "streak" } });
    expect((await runtimeStorage.catalog.load()).config.management.strategy).toBe("streak");

    await runtimeStorage.catalog.update({ config: { strategy: "both" } });
    expect((await runtimeStorage.catalog.load()).config.management.strategy).toBe("both");

    await runtimeStorage.catalog.update({ config: { name: "Renamed" } });
    expect((await runtimeStorage.catalog.load()).config.management.strategy).toBe("both");

    await runtimeStorage.catalog.update({ config: { strategy: "" } });
    expect((await runtimeStorage.catalog.load()).config.management.strategy).toBeUndefined();
  });
});
