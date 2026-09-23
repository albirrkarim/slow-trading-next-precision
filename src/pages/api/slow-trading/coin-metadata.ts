import coinTagsHandler from "@/lib/dev/coins/api/coinTags";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await coinTagsHandler(req, res);
}
