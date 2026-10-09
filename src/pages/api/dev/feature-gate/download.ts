import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { default: download } = await import("@/lib/dev/feature-gate/api/download");
  await download(req, res);
}
