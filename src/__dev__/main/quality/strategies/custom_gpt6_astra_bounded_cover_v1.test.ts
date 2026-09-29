import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeAveragingDecision,
  RuntimeContext,
} from "@/lib/precision/types";
import type { Position } from "@/lib/system/trading";
import both from "@/lib/strategies/both";
import boundedCover from "@/lib/strategies/custom_gpt6_astra_bounded_cover_v1";
import strategies from "@/lib/strategies";

describe("bounded cover handoff", () => {
  it("resolves by its own slug", async () => {
    expect(
      (await strategies.resolve("custom_gpt6_astra_bounded_cover_v1"))?.name,
    ).toBe("custom_gpt6_astra_bounded_cover_v1");
  });

  it("keeps averaging at the boundary and rejects deeper steps", async () => {
    const trading = { maxEntryAbsLevel: 2 };
    const context = {
      helper: { getAccountConfig: () => trading },
    } as unknown as RuntimeContext;
    const position = { account: "1" } as Position;
    const decision = {
      recommendation: { lvl: -3 },
    } as RuntimeAveragingDecision;
    const source = both.decisions!.averaging!;
    const find = boundedCover.decisions!.averaging!.find;
    const mock = vi.spyOn(source, "find").mockResolvedValue(decision);

    try {
      expect(await find(context, position)).toBeNull();

      decision.recommendation.lvl = -2;
      expect(await find(context, position)).toBe(decision);

      trading.maxEntryAbsLevel = 3;
      decision.recommendation.lvl = -3;
      expect(await find(context, position)).toBe(decision);
    } finally {
      mock.mockRestore();
    }
  });
});
