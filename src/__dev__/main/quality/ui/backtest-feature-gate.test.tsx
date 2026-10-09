/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("axios", () => ({ default: { ...http, isCancel: () => false, isAxiosError: () => false } }));

import { endpoints } from "@/components/endpoints";
import DatasetTab from "@/components/dev/backtest-precision/DatasetTab";
import filterStorage from "@/components/dev/backtest-precision/DatasetTab/filter-storage";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";

const FIRST_HASH = "1".repeat(64);
const SECOND_HASH = "2".repeat(64);

function row(symbol: string): FeatureGateDatasetRow {
  return {
    t: 1000, symbol, resolved: true, missScore: 3,
    feature: { shared: {}, coins: {
      [symbol]: {
        priceNormalized: { current: 0.5, history: [] },
        vwap: { dSigma: 1.4, price: 100, stdev: 10 },
        latestVpoint: { id: "newer", p: 200, t: 500 },
      },
      BTC: { priceNormalized: { current: 0.4, history: [] } },
    } },
    sequences: [
      { id: "start", l: "B", lvl: 0, p: 114, pct: 5, vb: 0, vq: 0, t: 1 },
      { id: "end", l: "T", lvl: 0, p: 100, pct: 5, vb: 0, vq: 0, t: 2 },
    ],
  } as FeatureGateDatasetRow;
}

class MockWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage(input: { rows: FeatureGateDatasetRow[]; slug: string }) {
    const allow = input.slug === "v2";
    window.setTimeout(() => this.onmessage?.({ data: { result: {
      decisions: input.rows.map(() => ({ allow, message: allow ? "allowed by v2" : "blocked by v1" })),
      metrics: {
        total: input.rows.length, resolved: input.rows.length, skipped: 0,
        accepted: allow ? input.rows.length : 0, rejected: allow ? 0 : input.rows.length,
        acceptanceRate: allow ? 1 : 0, acceptedQuality: allow ? 0 : undefined,
        goodRetained: undefined, badBlocked: allow ? 0 : 1,
        acceptedScoreDistribution: allow ? { "3": input.rows.length, avgScore: 3, worstScore: 3 } : {},
        topRejections: [], bySymbol: {},
      },
    } } } as MessageEvent), 0);
  }
  terminate() {}
}

beforeEach(() => {
  window.localStorage.removeItem(filterStorage.key);
  vi.stubGlobal("Worker", MockWorker);
  http.get.mockReset();
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
    return { data: { rows: [row(config?.params?.hash === FIRST_HASH ? "AAA" : "BBB")] } };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// BTEST:FEATURE_GATE_DATASET — the browser evaluates the loaded run and displays row decisions.
describe("feature-gate dataset selection", () => {
  it("shows one dataset table with the automatic entry decision, metrics and JSON inspection", async () => {
    render(<DatasetTab cacheKey={FIRST_HASH} />);
    const table = await screen.findByRole("table", { name: "Dataset rows" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Time", "Feature", "Level sequence", "Miss score", "Entry", "Debug",
    ]);
    expect(within(table).getByText("priceNorm @ entry")).toBeTruthy();
    expect(within(table).getByText("dσ 1.40", { exact: false })).toBeTruthy();
    expect(within(table).queryByText("dσ 10.00", { exact: false })).toBeNull();
    expect(await within(table).findByText("Pass")).toBeTruthy();
    expect(within(table).getByText("Gate approved:")).toBeTruthy();
    expect(within(table).getAllByText("allowed by v2")).toHaveLength(2);
    const panel = screen.getByRole("region", { name: "Feature gate evaluation" });
    expect(within(panel).getByText("v2 · 11111111")).toBeTruthy();
    expect(within(panel).getByText(/Acceptance rate/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Evaluate" })).toBeNull();
    expect(http.get).toHaveBeenCalledWith(endpoints.dev.featureGateDownload,
      expect.objectContaining({ params: { hash: FIRST_HASH } }));
    fireEvent.click(within(table).getByRole("button", { name: "JSON" }));
    const tree = await screen.findByRole("tree", { name: "AAA dataset JSON" });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(within(tree).getByText("feature:")).toBeTruthy();
    expect(within(tree).getByText("sequences:")).toBeTruthy();
  });

  it("re-evaluates when the gate changes and loads the next dataset once", async () => {
    render(<DatasetTab cacheKey={FIRST_HASH} />);
    await screen.findByText("Pass");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Feature gate" }));
    fireEvent.click(await screen.findByRole("option", { name: "Gate V1" }));
    expect(await screen.findByText("Block")).toBeTruthy();
    expect(screen.queryByText("Gate approved:")).toBeNull();
    expect(http.get.mock.calls.filter(([url]) => url === endpoints.dev.featureGateDownload)).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Dataset run" }));
    fireEvent.click(await screen.findByRole("option", { name: /BBB/ }));
    expect(await screen.findByText("v1 · 22222222")).toBeTruthy();
    expect(http.get).toHaveBeenCalledWith(endpoints.dev.featureGateDownload,
      expect.objectContaining({ params: { hash: SECOND_HASH } }));
  });

  it("filters locally and remembers filters without refetching the run", async () => {
    render(<DatasetTab cacheKey={FIRST_HASH} />);
    await screen.findByText("Pass");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "2" } });
    await screen.findByText(/No dataset rows match/);
    expect(http.get.mock.calls.filter(([url]) => url === endpoints.dev.featureGateDownload)).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(filterStorage.key)!).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByText(/No dataset rows match/)).toBeNull());
    expect(window.localStorage.getItem(filterStorage.key)).toBeNull();
  });
});
