import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { default: featureGateDatasetRowsHandler } = await import(
    "@/lib/dev/feature-gate/api/dataset-rows"
  );
  await featureGateDatasetRowsHandler(req, res);
}
