/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import viewStorage from "@/components/dev/backtest-precision/DatasetTab/view-storage";

const checks = ["vwap", "trend"];

describe("dataset subgate selections", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores v4 selections and remembers v5 independently", () => {
    window.localStorage.setItem("precision-backtest-dataset-v4-subgates", JSON.stringify(["trend"]));
    expect(viewStorage.readSubGates("v4", checks)).toEqual(["trend"]);
    expect(viewStorage.readSubGates("v5", checks)).toEqual(checks);

    viewStorage.writeSubGates("v5", [], checks);
    expect(viewStorage.readSubGates("v5", checks)).toEqual([]);
    expect(viewStorage.readSubGates("v4", checks)).toEqual(["trend"]);
  });
});
