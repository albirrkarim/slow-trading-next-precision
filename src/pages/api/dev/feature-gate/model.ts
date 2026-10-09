import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { default: model } = await import("@/lib/dev/feature-gate/api/model");
  await model(req, res);
}
