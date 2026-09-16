import { FILES } from "@/components/storage";
import type { NextApiRequest, NextApiResponse } from "next";
import precision from "@/lib/precision";
import type {
  PrecisionBacktestResultV1,
  ProdTestCaseV1,
} from "@/lib/precision/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") {
      res.status(200).json(await precision.backtest.list());
      return;
    }

    if (req.method === "POST") {
      const testCaseName = String(req.body?.testCase ?? "");
      const backtestName = String(req.body?.backtest ?? "");
      if (!testCaseName || !backtestName) {
        res.status(400).json({ error: "testCase and backtest are required" });
        return;
      }

      const testCasePath = precision.compare.path.resolve(
        FILES.slow.precision.testCaseRoot,
        testCaseName,
      );
      const backtestPath = precision.compare.path.resolve(
        FILES.slow.precision.backtestResultRoot,
        backtestName,
      );
      const [production, backtest] = await Promise.all([
        precision.compare.run.read(testCasePath),
        precision.compare.run.read(backtestPath),
      ]);
      const result = precision.compare.run.compare({
        production: production as ProdTestCaseV1,
        backtest: backtest as PrecisionBacktestResultV1,
      });
      res.status(200).json(result);
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    res.status(500).json({
      error: error?.message ?? "Failed to compare precision runs",
    });
  }
}
