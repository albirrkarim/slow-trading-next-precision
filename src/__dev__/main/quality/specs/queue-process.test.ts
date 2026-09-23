import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPrivate: vi.fn(),
}));

vi.mock("@/lib/exchange/platform/binance/utils", () => ({
  requestPrivate: mocks.requestPrivate,
}));

import jsonFile from "@/lib/system/storage/json-file";
import storageFiles from "@/lib/system/storage/files";
import { runtimeStorage, runtimeLogs } from "@/lib/system/storage";
import runtimeQueue from "@/lib/system/queue";
import type { RuntimeMode } from "@/lib/system/runtime/types";
import type {
  RuntimeQueues,
  RuntimeSafeHavenQueueItem,
  RuntimeWithdrawalQueueItem,
} from "@/lib/system/queue/types";

const ACCOUNT = "binance-1";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

let tmpRoot: string;

async function seedCatalog(options?: { sandbox?: boolean }): Promise<void> {
  await runtimeStorage.catalog.ensure();
  if (options?.sandbox) {
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      sandboxEnabled: true,
    });
  }
}

async function seedBalance(
  mode: RuntimeMode,
  balance: Record<string, number>,
): Promise<void> {
  await runtimeStorage.account.save({
    accountSlug: ACCOUNT,
    mode,
    state: { balance, positions: [] },
  });
}

async function readBalance(mode: RuntimeMode) {
  const state = await runtimeStorage.account.load({
    accountSlug: ACCOUNT,
    mode,
  });
  return state.balance;
}

function safeHavenItem(
  patch: Partial<RuntimeSafeHavenQueueItem> = {},
): RuntimeSafeHavenQueueItem {
  return {
    account: ACCOUNT,
    id: `sh-${Math.random().toString(36).slice(2, 10)}`,
    kind: "safe_haven",
    mode: "live",
    period: "2026-01",
    requestedUSDT: 100,
    remainingUSDT: 100,
    createdAt: NOW - 60_000,
    nextAttemptAt: NOW,
    lastMessage: "Queued.",
    ...patch,
  };
}

function withdrawalItem(
  patch: Partial<RuntimeWithdrawalQueueItem> = {},
): RuntimeWithdrawalQueueItem {
  return {
    account: ACCOUNT,
    id: `wd-${Math.random().toString(36).slice(2, 10)}`,
    kind: "withdrawal",
    scheduleId: "w1",
    scheduleName: "Monthly skim",
    amountUSDT: 100,
    targetNetwork: "BSC",
    targetWalletAddress: "0xabc",
    clientWithdrawId: "slow-w1-fixed",
    createdAt: NOW - 60_000,
    nextAttemptAt: NOW,
    lastMessage: "Queued.",
    ...patch,
  };
}

async function writeQueues(queues: Partial<RuntimeQueues>): Promise<void> {
  await jsonFile.write.atomic(storageFiles.prod.queue, {
    safeHaven: queues.safeHaven ?? [],
    withdrawals: queues.withdrawals ?? [],
  });
}

async function readQueues(): Promise<RuntimeQueues> {
  return runtimeQueue.items.load();
}

async function readWithdrawalLogs(): Promise<
  { status: string; message: string }[]
> {
  const raw = await fs
    .readJSON(storageFiles.prod.logs.withdrawals)
    .catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

describe("runtime queue processor", () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "queue-process-"));
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
    mocks.requestPrivate.mockReset();
  });

  afterEach(async () => {
    delete process.env.PERSISTENT_STORAGE_ROOT;
    await fs.remove(tmpRoot);
  });

  // PROD:SAFE_HAVEN_QUEUE
  it("moves a partial amount into Safe Haven and keeps the item pending", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 1000, safeHaven: 0 });
    await writeQueues({
      safeHaven: [safeHavenItem({ requestedUSDT: 500, remainingUSDT: 500 })],
    });

    const result = await runtimeQueue.process.run({ mode: "live", now: NOW });

    // movable = 1000 - max(reserved 0, floor 600) = 400 of 500 requested.
    expect(result.movedUSDT).toBe(400);
    expect(result.completed).toBe(0);
    const balance = await readBalance("live");
    expect(balance.quoteAsset).toBe(600);
    expect(balance.safeHaven).toBe(400);
    const queues = await readQueues();
    expect(queues.safeHaven).toHaveLength(1);
    expect(queues.safeHaven[0].remainingUSDT).toBe(100);
    expect(queues.safeHaven[0].lastAttemptAt).toBe(NOW);
  });

  it("completes and deletes a fully funded Safe Haven item", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 1000, safeHaven: 0 });
    await writeQueues({ safeHaven: [safeHavenItem()] });

    const result = await runtimeQueue.process.run({ mode: "live", now: NOW });

    expect(result).toEqual({ completed: 1, movedUSDT: 100, queued: 0 });
    const balance = await readBalance("live");
    expect(balance.quoteAsset).toBe(900);
    expect(balance.safeHaven).toBe(100);
    expect(balance.safeHavenRequest).toBe(0);
    expect((await readQueues()).safeHaven).toHaveLength(0);
    const logs = await runtimeLogs.load();
    expect(logs.safeHaven[0]?.deltaUSDT).toBe(100);
  });

  it("waits without moving funds when spendable is below the floor", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 500, safeHaven: 0 });
    await writeQueues({ safeHaven: [safeHavenItem()] });

    const result = await runtimeQueue.process.run({ mode: "live", now: NOW });

    expect(result.movedUSDT).toBe(0);
    const balance = await readBalance("live");
    expect(balance.quoteAsset).toBe(500);
    expect(balance.safeHaven).toBe(0);
    const item = (await readQueues()).safeHaven[0];
    expect(item.lastMessage).toContain("Waiting for spendable");
    expect(item.nextAttemptAt).toBe(NOW + 5 * 60_000);
    expect(item.lastAttemptAt).toBe(NOW);
  });

  it("keeps the averaging reserve out of the movable amount", async () => {
    await seedCatalog();
    await seedBalance("live", {
      quoteAsset: 1000,
      reservedQuoteAsset: 450,
      safeHaven: 0,
    });
    await writeQueues({
      safeHaven: [safeHavenItem({ requestedUSDT: 900, remainingUSDT: 900 })],
    });

    await runtimeQueue.process.run({ mode: "live", now: NOW });

    // movable = 1000 - max(450, 600) = 400.
    expect((await readBalance("live")).safeHaven).toBe(400);
  });

  it("skips items owned by the other mode", async () => {
    await seedCatalog({ sandbox: true });
    await seedBalance("sandbox", { quoteAsset: 1000, safeHaven: 0 });
    await writeQueues({
      safeHaven: [safeHavenItem({ mode: "live" })],
    });

    const result = await runtimeQueue.process.run({
      mode: "sandbox",
      now: NOW,
    });

    expect(result.movedUSDT).toBe(0);
    const item = (await readQueues()).safeHaven[0];
    expect(item.lastAttemptAt).toBeUndefined();
  });

  // PROD:SAFE_HAVEN_SCHEDULE_QUEUE
  it("auto-queues a due Safe Haven schedule once per mode and month", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 1000, safeHaven: 0 });
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      safeHaven: {
        autoEnabled: true,
        schedules: [
          {
            id: "sh1",
            name: "Monthly 10%",
            enabled: true,
            amountUSDT: 0,
            pct: 10,
            dayOfMonth: 15,
          },
        ],
      },
    });

    const first = await runtimeQueue.process.run({ mode: "live", now: NOW });
    // 10% of 1000 total = 100 queued; 400 movable → moves 100 fully.
    expect(first.queued).toBe(1);
    expect(first.movedUSDT).toBe(100);
    expect(first.completed).toBe(1);

    const catalog = await runtimeStorage.catalog.load();
    expect(
      catalog.config.runtime.safeHaven.schedules[0].lastQueuedAt?.live,
    ).toBe(NOW);
    expect(
      catalog.config.runtime.safeHaven.schedules[0].lastQueuedAt?.sandbox,
    ).toBeUndefined();

    const second = await runtimeQueue.process.run({
      mode: "live",
      now: NOW + 60_000,
    });
    expect(second.queued).toBe(0);
    expect((await readQueues()).safeHaven).toHaveLength(0);
  });

  it("auto-queues a due withdrawal schedule once per month", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 0, safeHaven: 0 });
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      withdrawal: {
        autoEnabled: true,
        walletBook: [],
        schedules: [
          {
            id: "w1",
            account: ACCOUNT,
            name: "Monthly skim",
            enabled: true,
            amountUSDT: 100,
            dayOfMonth: 15,
            targetNetwork: "bsc",
            targetWalletAddress: "0xabc",
          },
        ],
      },
    });

    const first = await runtimeQueue.process.run({ mode: "live", now: NOW });
    expect(first.queued).toBe(1);
    const queues = await readQueues();
    expect(queues.withdrawals).toHaveLength(1);
    expect(queues.withdrawals[0].targetNetwork).toBe("BSC");
    // Same pass already attempted it: Safe Haven is empty so it waits.
    expect(queues.withdrawals[0].lastAttemptAt).toBe(NOW);

    const second = await runtimeQueue.process.run({
      mode: "live",
      now: NOW + 60_000,
    });
    expect(second.queued).toBe(0);
    expect((await readQueues()).withdrawals).toHaveLength(1);
  });

  // PROD:WITHDRAW_QUEUE
  it("keeps a withdrawal waiting until Safe Haven holds the full amount", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 0, safeHaven: 50 });
    await writeQueues({ withdrawals: [withdrawalItem()] });

    const result = await runtimeQueue.process.run({ mode: "live", now: NOW });

    expect(result.completed).toBe(0);
    expect(mocks.requestPrivate).not.toHaveBeenCalled();
    const item = (await readQueues()).withdrawals[0];
    expect(item.lastMessage).toContain("Waiting for Safe Haven");
    expect(item.nextAttemptAt).toBe(NOW + 5 * 60_000);
  });

  it("runs Safe Haven funding before withdrawals in the same pass", async () => {
    await seedCatalog({ sandbox: true });
    await seedBalance("sandbox", { quoteAsset: 800, safeHaven: 0 });
    await writeQueues({
      safeHaven: [safeHavenItem({ mode: "sandbox", requestedUSDT: 200, remainingUSDT: 200 })],
      withdrawals: [withdrawalItem({ amountUSDT: 150 })],
    });

    const result = await runtimeQueue.process.run({
      mode: "sandbox",
      now: NOW,
    });

    // Safe Haven moved 200 (800 - 600 floor), then the funded withdrawal
    // completed as sandbox bookkeeping in the same pass.
    expect(result.movedUSDT).toBe(200);
    expect(result.completed).toBe(2);
    expect((await readBalance("sandbox")).safeHaven).toBe(50);
    expect(mocks.requestPrivate).not.toHaveBeenCalled();
    const queues = await readQueues();
    expect(queues.safeHaven).toHaveLength(0);
    expect(queues.withdrawals).toHaveLength(0);
  });

  it("executes sandbox withdrawals as bookkeeping without exchange calls", async () => {
    await seedCatalog({ sandbox: true });
    await seedBalance("sandbox", { quoteAsset: 0, safeHaven: 500 });
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      withdrawal: {
        autoEnabled: false,
        walletBook: [],
        schedules: [
          {
            id: "w1",
            account: ACCOUNT,
            name: "Monthly skim",
            enabled: true,
            amountUSDT: 100,
            dayOfMonth: 15,
            targetNetwork: "BSC",
            targetWalletAddress: "0xabc",
          },
        ],
      },
    });
    await writeQueues({ withdrawals: [withdrawalItem()] });

    const result = await runtimeQueue.process.run({
      mode: "sandbox",
      now: NOW,
    });

    expect(result.completed).toBe(1);
    expect(mocks.requestPrivate).not.toHaveBeenCalled();
    expect((await readBalance("sandbox")).safeHaven).toBe(400);
    const catalog = await runtimeStorage.catalog.load();
    expect(catalog.config.runtime.withdrawal.schedules[0].lastStatus).toBe(
      "EXECUTED:SANDBOX",
    );
    const logs = await readWithdrawalLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("executed");
    expect(logs[0].message).toContain("Sandbox bookkeeping");
  });

  it("executes a funded live withdrawal and removes the item", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 0, safeHaven: 500 });
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      withdrawal: {
        autoEnabled: false,
        walletBook: [],
        schedules: [
          {
            id: "w1",
            account: ACCOUNT,
            name: "Monthly skim",
            enabled: true,
            amountUSDT: 100,
            dayOfMonth: 15,
            targetNetwork: "BSC",
            targetWalletAddress: "0xabc",
          },
        ],
      },
    });
    mocks.requestPrivate.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/sapi/v1/capital/config/getall") {
        return [{ coin: "USDT", free: "500" }];
      }
      if (endpoint === "/sapi/v1/capital/withdraw/apply") {
        return { id: "binance-wd-1" };
      }
      throw new Error(`Unexpected Binance endpoint: ${endpoint}`);
    });
    await writeQueues({ withdrawals: [withdrawalItem()] });

    const result = await runtimeQueue.process.run({ mode: "live", now: NOW });

    expect(result.completed).toBe(1);
    const applyCall = mocks.requestPrivate.mock.calls.find(
      ([endpoint]) => endpoint === "/sapi/v1/capital/withdraw/apply",
    );
    expect(applyCall?.[1]?.withdrawOrderId).toBe("slow-w1-fixed");
    expect((await readBalance("live")).safeHaven).toBe(400);
    expect((await readQueues()).withdrawals).toHaveLength(0);
    const catalog = await runtimeStorage.catalog.load();
    expect(catalog.config.runtime.withdrawal.schedules[0].lastStatus).toBe(
      "EXECUTED:binance-wd-1",
    );
  });

  it("reuses the stable client withdraw id and dedupes identical failures", async () => {
    await seedCatalog();
    await seedBalance("live", { quoteAsset: 0, safeHaven: 500 });
    await runtimeStorage.catalog.update({
      account: ACCOUNT,
      withdrawal: {
        autoEnabled: false,
        walletBook: [],
        schedules: [
          {
            id: "w1",
            account: ACCOUNT,
            name: "Monthly skim",
            enabled: true,
            amountUSDT: 100,
            dayOfMonth: 15,
            targetNetwork: "BSC",
            targetWalletAddress: "0xabc",
          },
        ],
      },
    });
    let attempts = 0;
    mocks.requestPrivate.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/sapi/v1/capital/config/getall") {
        return [{ coin: "USDT", free: "500" }];
      }
      if (endpoint === "/sapi/v1/capital/withdraw/apply") {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error("Binance API Error: temporarily blocked");
        }
        return { id: "binance-wd-2" };
      }
      throw new Error(`Unexpected Binance endpoint: ${endpoint}`);
    });
    await writeQueues({ withdrawals: [withdrawalItem()] });

    // Two failing passes: same message → one failed log; same client id.
    await runtimeQueue.process.run({ mode: "live", now: NOW });
    await runtimeQueue.process.run({ mode: "live", now: NOW + 5 * 60_000 });
    const item = (await readQueues()).withdrawals[0];
    expect(item.lastMessage).toContain("temporarily blocked");
    expect(item.nextAttemptAt).toBe(NOW + 10 * 60_000);
    expect(
      (await readWithdrawalLogs()).filter((log) => log.status === "failed"),
    ).toHaveLength(1);

    // Third pass succeeds with the same clientWithdrawId.
    const third = await runtimeQueue.process.run({
      mode: "live",
      now: NOW + 10 * 60_000,
    });
    expect(third.completed).toBe(1);
    const applyCalls = mocks.requestPrivate.mock.calls.filter(
      ([endpoint]) => endpoint === "/sapi/v1/capital/withdraw/apply",
    );
    expect(applyCalls).toHaveLength(3);
    for (const call of applyCalls) {
      expect(call[1].withdrawOrderId).toBe("slow-w1-fixed");
    }
    expect((await readQueues()).withdrawals).toHaveLength(0);
  });
});
