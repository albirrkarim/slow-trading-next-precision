/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({ default: { ...http, isCancel: () => false, isAxiosError: () => false } }));

import { endpoints } from "@/components/endpoints";
import DatasetTab from "@/components/dev/backtest-precision/DatasetTab";
import DatasetTable from "@/components/dev/backtest-precision/DatasetTab/DatasetTable";
import filterStorage from "@/components/dev/backtest-precision/DatasetTab/filter-storage";

const FIRST_HASH = "1".repeat(64);
const SECOND_HASH = "2".repeat(64);

beforeEach(() => {
  window.localStorage.removeItem(filterStorage.key);
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockImplementation(async (url: string, config?: { params?: { hash?: string } }) => {
    if (url === endpoints.dev.featureGateList) {
      return { data: { gates: [{ slug: "v2", label: "Gate V2" }, { slug: "v1", label: "Gate V1" }] } };
    }
    if (url === endpoints.dev.featureGateDatasets) {
      return { data: { datasets: [
        { hash: FIRST_HASH, coins: ["AAA"], range: "5year" },
        { hash: SECOND_HASH, coins: ["BBB"], range: "3year" },
      ] } };
    }
    const first = config?.params?.hash === FIRST_HASH;
    const symbol = first ? "AAA" : "BBB";
    return { data: {
      page: 1, pageSize: 50, total: 1, symbols: [symbol],
      rows: [{
        t: 1000, symbol, resolved: true, missScore: 0,
        feature: { shared: {}, coins: {
          [symbol]: {
            priceNormalized: { current: 0.5, history: [] },
            vwap: { price: 100, stdev: 10 },
            latestVpoint: { id: "newer", p: 200, t: 500 },
          },
          BTC: { priceNormalized: { current: 0.4, history: [] } },
        } },
        sequences: [
          { id: "start", l: first ? "B" : "T", lvl: 0, p: 114, t: 1 },
          { id: "end", l: first ? "T" : "B", lvl: 0, p: 100, t: 2 },
        ],
      }],
    } };
  });
  http.post.mockImplementation(async (_url: string, input: { hash: string; slug: string }) => ({
    data: { ...input, metrics: {
      total: 1, resolved: 1, accepted: 1, rejected: 0, skipped: 0,
      acceptanceRate: 1, acceptedQuality: 1, goodRetained: 1,
      acceptedScoreDistribution: { "0": 1, "2": 1, avgScore: 0.5, worstScore: 2 },
      topRejections: [], bySymbol: {},
    } },
  }));
});

afterEach(cleanup);

// BTEST:FEATURE_GATE_DATASET — switching datasets updates inspection and inference together.
describe("feature-gate dataset selection", () => {
  it("shows the documented columns, shared feature preview, full JSON dialog and evaluation metrics", async () => {
    render(<DatasetTab cacheKey={FIRST_HASH} />);
    await screen.findByText("B0→T0");
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Time", "Feature", "Level sequence", "Miss score", "Debug",
    ]);
    expect(screen.getByText("priceNorm @ entry")).toBeTruthy();
    // The dataset starting signal is 114, despite snapshot.latestVpoint.p = 200.
    expect(screen.getByText("· dσ 1.40", { exact: false })).toBeTruthy();
    expect(screen.queryByText("· dσ 10.00", { exact: false })).toBeNull();
    const panel = screen.getByRole("region", { name: "Feature gate evaluation" });
    expect(within(panel).getByText("Evaluation metrics")).toBeTruthy();
    expect(within(panel).getByText(/Select a gate and click Evaluate/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Evaluate" }));
    await within(panel).findByText("v2 · 11111111");
    expect(within(panel).getByText(/Acceptance rate/)).toBeTruthy();
    expect(within(panel).getByText(/Accepted quality/)).toBeTruthy();
    expect(within(panel).getByText(/Good opportunities retained/)).toBeTruthy();
    expect(within(panel).getByText(/Bad opportunities blocked/)).toBeTruthy();
    expect(within(panel).getByText(/Accepted score distribution/)).toBeTruthy();

    expect(screen.getByTitle("View vPoint chart")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const tree = await screen.findByRole("tree", { name: "AAA dataset JSON" });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(within(tree).getByText("feature:")).toBeTruthy();
    expect(within(tree).getByText("sequences:")).toBeTruthy();
    expect(within(tree).getByText("missScore:")).toBeTruthy();
    await waitFor(() => {
      const expanded = screen.getByRole("tree", { name: "AAA dataset JSON" });
      expect(within(expanded).getByText('"start"')).toBeTruthy();
    });
  });

  it("switches table requests and clears stale report display when the dataset changes", async () => {
    render(<DatasetTab cacheKey={FIRST_HASH} />);
    expect(await screen.findByText("B0→T0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(await screen.findByText("v2 · 11111111")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Dataset run" }));
    fireEvent.click(await screen.findByRole("option", { name: /BBB/ }));
    expect(await screen.findByText("T0→B0")).toBeTruthy();
    expect(screen.queryByText("B0→T0")).toBeNull();
    expect(screen.queryByText("v2 · 11111111")).toBeNull();
    expect(http.get).toHaveBeenCalledWith(endpoints.dev.featureGateDatasetRows,
      expect.objectContaining({ params: expect.objectContaining({ hash: SECOND_HASH }) }));

    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(await screen.findByText("v2 · 22222222")).toBeTruthy();
    expect(http.post).toHaveBeenLastCalledWith(endpoints.dev.featureGateEvaluate,
      { hash: SECOND_HASH, slug: "v2" });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Feature gate" }));
    fireEvent.click(await screen.findByRole("option", { name: "Gate V1" }));
    await waitFor(() => expect(screen.queryByText("v2 · 22222222")).toBeNull());
  });

  it("sends the flexible condition and combined filters to the server and resets pagination", async () => {
    const getRows = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (...args) => {
      const response = await getRows(...args);
      return { data: { ...response.data, total: 100 } };
    });
    const view = render(<DatasetTable cacheKey={FIRST_HASH} />);
    await screen.findByText("B0→T0");
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    await waitFor(() => expect(http.get).toHaveBeenLastCalledWith(endpoints.dev.featureGateDatasetRows,
      expect.objectContaining({ params: expect.objectContaining({ page: 2 }) })));
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "2" } });
    await waitFor(() => expect(http.get).toHaveBeenLastCalledWith(endpoints.dev.featureGateDatasetRows,
      expect.objectContaining({ params: expect.objectContaining({ metric: "missScore", operator: "eq", value: 2, page: 1 }) })));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "What" }));
    fireEvent.click(await screen.findByRole("option", { name: "Coin price normalized" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Operator" }));
    fireEvent.click(await screen.findByRole("option", { name: "<" }));
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("Capture from"), { target: { value: "2024-01-01" } });
    fireEvent.change(screen.getByLabelText("Capture to"), { target: { value: "2024-12-31" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Symbol" }));
    fireEvent.click(await screen.findByRole("option", { name: "AAA" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Resolved only" }));
    await waitFor(() => expect(http.get).toHaveBeenLastCalledWith(endpoints.dev.featureGateDatasetRows,
      expect.objectContaining({ params: expect.objectContaining({ metric: "priceNormalized", operator: "lt", value: 0.3, resolved: "true", fromT: new Date("2024-01-01T00:00:00").getTime() }) })));
    expect(JSON.parse(window.localStorage.getItem(filterStorage.key)!)).toEqual({
      symbol: "AAA", resolvedOnly: true, from: "2024-01-01", to: "2024-12-31", metric: "priceNormalized", operator: "lt", value: "0.3",
    });
    view.unmount();
    render(<DatasetTable cacheKey={SECOND_HASH} />);
    await screen.findByText("T0→B0");
    expect(http.get).toHaveBeenLastCalledWith(endpoints.dev.featureGateDatasetRows,
      expect.objectContaining({ params: expect.objectContaining({ hash: SECOND_HASH, symbol: "AAA", metric: "priceNormalized", operator: "lt", value: 0.3, resolved: "true", fromT: new Date("2024-01-01T00:00:00").getTime(), toT: new Date("2024-12-31T23:59:59.999").getTime(), page: 1 }) }));
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("0.3");
    expect((screen.getByRole("checkbox", { name: "Resolved only" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      const params = http.get.mock.lastCall?.[1].params;
      expect(params.metric).toBeUndefined();
      expect(params.resolved).toBeUndefined();
      expect(params.fromT).toBeUndefined();
      expect(params.toT).toBeUndefined();
      expect(params.symbol).toBeUndefined();
      expect(params.page).toBe(1);
    });
    expect(window.localStorage.getItem(filterStorage.key)).toBeNull();
  });

  it("handles malformed saved filters and unavailable localStorage without breaking filtering", () => {
    window.localStorage.setItem(filterStorage.key, "invalid JSON");
    expect(filterStorage.read()).toEqual(filterStorage.defaults);
    window.localStorage.setItem(filterStorage.key, JSON.stringify({
      symbol: 42, resolvedOnly: "false", from: "2024-02-30", to: "invalid", metric: "constructor", operator: "constructor", value: "Infinity",
    }));
    expect(filterStorage.read()).toEqual(filterStorage.defaults);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(filterStorage.read()).toEqual(filterStorage.defaults);
      expect(() => filterStorage.write({ ...filterStorage.defaults, value: "0" })).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
