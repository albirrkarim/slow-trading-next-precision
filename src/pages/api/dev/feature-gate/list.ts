import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { default: featureGateListHandler } = await import(
    "@/lib/dev/feature-gate/api/list"
  );
  await featureGateListHandler(req, res);
}
