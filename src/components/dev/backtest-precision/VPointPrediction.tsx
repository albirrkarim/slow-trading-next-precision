"use client";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import vPointPrediction from "@/lib/dev/backtestPrecision/analysis/vpoint-prediction";
import type { VPointPredictionArm } from "@/lib/dev/backtestPrecision/analysis/vpoint-prediction";
import type { VolatilityPoint } from "@/lib/system/types";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";

const LETTER_LABEL: Record<string, string> = { B: "BOTTOM", T: "TOP" };

const MATRIX_TOOLTIPS = {
  fn: "False negative — the rule skipped this point but the predicted vPoint formed (a winning entry was missed).",
  fp: "False positive — the rule entered but the opposite vPoint formed (a losing entry).",
  pending:
    "The rule entered but the point is still its symbol's latest — no successor emitted yet.",
  tn: "True negative — the rule skipped this point and the opposite vPoint formed (a losing entry avoided).",
  tp: "True positive — the rule entered and the predicted vPoint formed (a winning entry).",
} as const;

function formatArmDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function formatArmDetail(arm: VPointPredictionArm): string {
  const outcome = arm.actual
    ? arm.status === "missed"
      ? `missed → formed ${LETTER_LABEL[arm.actual]}`
      : `formed ${LETTER_LABEL[arm.actual]}`
    : "pending";
  return [
    formatArmDate(arm.t),
    arm.symbol?.replace(/_USDT$/, ""),
    arm.id,
    `L${arm.lvl}`,
    `↑ ${arm.maxUpPct !== undefined ? `${arm.maxUpPct.toFixed(2)}%` : "—"}`,
    `↓ ${arm.maxDownPct !== undefined ? `${arm.maxDownPct.toFixed(2)}%` : "—"}`,
    `armed ${arm.armedPct.toFixed(2)}%`,
    `→ ${outcome}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function ArmList({
  arms,
  title,
}: {
  arms: VPointPredictionArm[];
  title: string;
}) {
  if (arms.length === 0) return null;
  return (
    <TableContainer
      component={Paper}
      sx={{ maxHeight: 240, mt: 0.75 }}
      variant="outlined"
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>
              {title} ({arms.length})
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {arms.map((arm) => (
            <TableRow key={`${arm.id}-${arm.predicted}`}>
              <TableCell>
                <Typography
                  color="text.secondary"
                  sx={{ overflowWrap: "anywhere" }}
                  variant="caption"
                >
                  {formatArmDetail(arm)}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function MatrixCell({ label, tip }: { label: string; tip: string }) {
  return (
    <TableCell align="right">
      <Tooltip arrow placement="top" title={tip}>
        <Box component="span" sx={{ cursor: "help" }}>
          {label}
        </Box>
      </Tooltip>
    </TableCell>
  );
}

export default function VPointPrediction({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const [favorableInput, setFavorableInput] = useState(
    String(vPointPrediction.favorable.defaultValue),
  );
  const [adverseInput, setAdverseInput] = useState(
    String(vPointPrediction.adverse.defaultValue),
  );
  const favorablePct = vPointPrediction.favorable.normalize(
    Number(favorableInput),
  );
  const adversePct = vPointPrediction.adverse.normalize(Number(adverseInput));
  const result = useMemo(
    () =>
      vPointPrediction.compute({
        adversePct,
        endTimeMs: endTime,
        favorablePct,
        startTimeMs: startTime,
        volatilityMap,
      }),
    [adversePct, endTime, favorablePct, startTime, volatilityMap],
  );

  const failedArms = result.arms.filter((arm) => arm.status === "failed");
  const missedArms = result.misses;

  return (
    <HeaderMetrics
      defaultExpanded={false}
      rememberExpand="vpoint-prediction"
      title={
        <Typography fontWeight="bold" variant="body1">
          Next vPoint predictive
        </Typography>
      }
      headerCanBeClicked
    >
      {(expanded) =>
        expanded && (
          <Box sx={{ minWidth: 0, mt: 1, whiteSpace: "normal" }}>
            <Box
              sx={{
                alignItems: "center",
                display: "flex",
                gap: 1,
                justifyContent: "space-between",
                mb: 1,
              }}
            >
              <Box>
                <Typography variant="body2">
                  {result.evaluated.toLocaleString()} vPoints evaluated
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  Entry fires when the favorable excursion reaches its
                  threshold while the opposite stays below the adverse one.
                  {result.noData > 0
                    ? ` ${result.noData.toLocaleString()} points have no excursion data.`
                    : ""}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flex: "0 0 auto", gap: 1 }}>
                <TextField
                  label="Favorable %"
                  onBlur={() => setFavorableInput(String(favorablePct))}
                  onChange={(event) => setFavorableInput(event.target.value)}
                  size="small"
                  slotProps={{
                    htmlInput: {
                      inputMode: "decimal",
                      min: vPointPrediction.favorable.minimum,
                      step: "0.1",
                    },
                  }}
                  sx={{ flex: "0 0 105px" }}
                  type="number"
                  value={favorableInput}
                />
                <TextField
                  label="Adverse %"
                  onBlur={() => setAdverseInput(String(adversePct))}
                  onChange={(event) => setAdverseInput(event.target.value)}
                  size="small"
                  slotProps={{
                    htmlInput: {
                      inputMode: "decimal",
                      min: vPointPrediction.adverse.minimum,
                      step: "0.1",
                    },
                  }}
                  sx={{ flex: "0 0 100px" }}
                  type="number"
                  value={adverseInput}
                />
              </Box>
            </Box>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Prediction</TableCell>
                    <MatrixCell label="TP" tip={MATRIX_TOOLTIPS.tp} />
                    <MatrixCell label="FP" tip={MATRIX_TOOLTIPS.fp} />
                    <MatrixCell label="TN" tip={MATRIX_TOOLTIPS.tn} />
                    <MatrixCell label="FN" tip={MATRIX_TOOLTIPS.fn} />
                    <MatrixCell label="Pending" tip={MATRIX_TOOLTIPS.pending} />
                    <TableCell align="right">Accuracy</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.directions.map((direction) => (
                    <TableRow
                      key={`${direction.source}-${direction.predicted}`}
                    >
                      <TableCell>
                        {LETTER_LABEL[direction.source]} →{" "}
                        {LETTER_LABEL[direction.predicted]}
                      </TableCell>
                      <TableCell align="right">
                        {direction.tp.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {direction.fp.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {direction.tn.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {direction.fn.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {direction.pending.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {direction.accuracyPct === undefined
                          ? "—"
                          : `${direction.accuracyPct.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {result.directions.length === 0 && (
                    <TableRow>
                      <TableCell align="center" colSpan={7}>
                        No evaluated vPoints in this range.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <ArmList
              arms={failedArms}
              title="False positives — entered, lost"
            />
            <ArmList
              arms={missedArms}
              title="False negatives — skipped, would have won"
            />
          </Box>
        )
      }
    </HeaderMetrics>
  );
}
