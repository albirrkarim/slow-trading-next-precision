import axios from "axios";
import { describe, expect, it, vi } from "vitest";

import { entryDiagnosticsStore } from "@/components/LiveDashboard/Feature/use-entry-diagnostics";
import { endpoints } from "@/components/endpoints";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

describe("entry diagnostics refresh", () => {
  it("fetches again after an older request finishes", async () => {
    // PROD:ACCOUNT_TRADING_SAVE_RUNTIME_REFRESH
    const get = vi.mocked(axios.get);
    let finishOldRequest: (value: { data: { generatedAt: number } }) => void =
      () => undefined;
    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    );
    get.mockResolvedValueOnce({ data: { generatedAt: 2 } });

    const oldRequest = entryDiagnosticsStore.refresh();
    const afterSave = entryDiagnosticsStore.refresh();
    expect(get).toHaveBeenCalledTimes(1);

    finishOldRequest({ data: { generatedAt: 1 } });
    await Promise.all([oldRequest, afterSave]);

    expect(get).toHaveBeenNthCalledWith(
      2,
      endpoints.system.manual.diagnostics,
    );
  });
});
