import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("child_process", () => ({ fork: mocks.fork }));

import backtestWorker from "@/lib/dev/backtestPrecision/api/worker-client";
import type { BacktestWorkerRequest } from "@/lib/dev/backtestPrecision/api/worker";

const request = {
  artifacts: { dir: "/tmp/backtest-test" },
  range: "6month",
} as BacktestWorkerRequest;

describe("backtest worker client", () => {
  let child: EventEmitter & { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      send: vi.fn((_message, callback: (error?: Error) => void) => callback()),
    });
    mocks.fork.mockReturnValue(child);
  });

  it("runs the simulation in a child process and returns its slim result", async () => {
    const pending = backtestWorker.run(request);
    expect(mocks.fork).toHaveBeenCalledWith(
      expect.stringContaining("/backtestPrecision/api/worker.ts"),
      [],
      expect.objectContaining({ stdio: ["ignore", "inherit", "inherit", "ipc"] }),
    );
    expect(child.send).toHaveBeenCalledWith(request, expect.any(Function));

    const result = {
      counts: { closedPositions: 1, positions: 1, snapshots: 1, vPoints: 1 },
      exchangeType: "binance",
      parts: { positions: 1, snapshots: {}, vpoints: {} },
      summary: { accounts: [], exits: {} },
    };
    child.emit("message", { ok: true, result });
    await expect(pending).resolves.toEqual(result);
  });

  it("reports a worker crash instead of returning partial results", async () => {
    const pending = backtestWorker.run(request);
    child.emit("exit", 1, null);
    await expect(pending).rejects.toThrow("exited before returning a result");
  });
});
