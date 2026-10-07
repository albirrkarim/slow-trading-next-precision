import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { default: featureGateDatasetsHandler } = await import(
    "@/lib/dev/feature-gate/api/datasets"
  );
  await featureGateDatasetsHandler(req, res);
}
