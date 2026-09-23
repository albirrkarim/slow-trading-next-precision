import type { NextApiRequest, NextApiResponse } from "next";
import { runtimeStorage } from "@/lib/system/storage";
import blackSwan from "@/lib/system/trading/black-swan";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    if (req.body?.action !== "acknowledge-recovery") {
      res.status(400).json({ error: "Unknown Black Swan action" });
      return;
    }

    const catalog = await runtimeStorage.catalog.load();
    const current = blackSwan.state.normalize(
      (await runtimeStorage.status.load(catalog.mode)).blackSwan,
    );
    if (current.status !== "RECOVERY") {
      throw new Error("Black Swan protection is not in RECOVERY.");
    }

    const state = (
      await runtimeStorage.status.update(catalog.mode, (status) => {
        status.blackSwan = blackSwan.state.acknowledge(current);
      })
    ).blackSwan;
    res.status(200).json({ state });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Action failed",
    });
  }
}
