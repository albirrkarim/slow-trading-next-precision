/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => ({ default: { ...http, isCancel: () => false, isAxiosError: () => false } }));

import { endpoints } from "@/components/endpoints";
import DatasetTab from "@/components/dev/backtest-precision/DatasetTab";

const FIRST_HASH = "1".repeat(64);
const SECOND_HASH = "2".repeat(64);

beforeEach(() => {
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
      acceptedScoreDistribution: { "0": 1, "1": 0, "2": 0, "3+": 0 },
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
});
