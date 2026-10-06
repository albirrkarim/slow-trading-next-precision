import type { NextApiRequest, NextApiResponse } from "next";

import type { RuntimeFeatures } from "@/lib/features/types";
import production from "@/lib/production";
import { systemLog } from "@/lib/system/logging";
import type { RuntimeMode } from "@/lib/system/runtime/types";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";

interface FeaturesResponse {
  /** Server clock at read time (ms). */
  t: number;
  mode: RuntimeMode;
  features: RuntimeFeatures | null;
}

/**
 * Serves the live feature store (`state.features`) — the per-coin
 * `priceNormalized` group (current value plus history trail) the
 * dashboard charts. Prefers the running
 * engine's in-memory snapshot; falls back to the persisted
 * `features.json[mode]` slice so the page still renders while the
 * engine is restarting.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    // Ensures the runtime singleton exists, mirroring api/system/state.
    const runtime = production.runtime.get();

    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      res.status(405).end(`Method ${req.method} Not Allowed`);
      return;
    }

    const engineState = runtime.getState();
    const queryMode = req.query.mode;
    const mode: RuntimeMode =
      queryMode === "sandbox" || queryMode === "live"
        ? queryMode
        : engineState?.mode === "sandbox"
          ? "sandbox"
          : "live";

    const features =
      engineState?.mode === mode && engineState.features
        ? engineState.features
        : ((await runtimeStorage.features.load(mode)) ?? null);

    res.setHeader("Cache-Control", "no-store");
    res
      .status(200)
      .json({ t: Date.now(), mode, features } satisfies FeaturesResponse);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.features",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[precision] failed to write storage error log",
          logError,
        );
      });
    res.status(500).json({
      error: error?.message ?? "Failed to load runtime features",
    });
  }
}
