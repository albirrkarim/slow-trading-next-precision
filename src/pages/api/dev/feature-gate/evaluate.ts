import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { default: featureGateEvaluateHandler } = await import(
    "@/lib/dev/feature-gate/api/evaluate"
  );
  await featureGateEvaluateHandler(req, res);
}
