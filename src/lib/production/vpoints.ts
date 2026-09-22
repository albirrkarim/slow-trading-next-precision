import { FILES } from "@/components/storage";
import type { PredictionEngineMemory, VolatilityPoint } from "@/lib/dynamic";
import type { ExchangeType } from "@/lib/exchange";
import vpoints from "@/lib/precision/utils/vpoints";
import jsonFile from "@/lib/slowTrading/storage/json-file";

/**
 * Atomically merges vPoints into one symbol's persisted volatility file at
 * `prod/volatility/<exchangeType>/<symbol>.json`.
 *
 * Points are merged by `id`: the full detected history already on disk is
 * preserved while runtime-only mutations — `usedBy<accountSlug>` markers and
 * newly detected points — are written through. Passing a single-point array
 * persists one point; passing the retained runtime window flushes markers.
 */
async function persistPoints(params: {
  exchangeType: ExchangeType;
  symbol: string;
  points: VolatilityPoint[];
}): Promise<void> {
  const memory: PredictionEngineMemory = {
    symbol: params.symbol,
    lastVolatility: params.points,
  };

  await jsonFile.update.atomic<PredictionEngineMemory>(
    `${FILES.prod.volatility(params.exchangeType)}/${params.symbol}.json`,
    (current) => {
      const persisted = current as PredictionEngineMemory | undefined;
      return {
        ...persisted,
        ...memory,
        lastVolatility: vpoints.mergeById(
          persisted?.lastVolatility ?? [],
          memory.lastVolatility,
        ),
      };
    },
  );
}

/** Grouped production vPoint persistence operations. */
const vpointFiles = {
  persistPoints,
};

export default vpointFiles;
