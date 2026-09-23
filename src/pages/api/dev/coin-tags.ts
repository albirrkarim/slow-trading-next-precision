import { isDevBacktestEnabled } from "@/lib/dev/enabled";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!isDevBacktestEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { default: coinTagsHandler } =
    await import("@/lib/dev/coins/api/coinTags");
  await coinTagsHandler(req, res);
}
