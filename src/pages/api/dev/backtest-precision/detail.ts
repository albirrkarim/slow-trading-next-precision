import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { default: backtestDetailHandler } = await import(
    "@/lib/dev/backtestPrecision/api/detail"
  );
  await backtestDetailHandler(req, res);
}
