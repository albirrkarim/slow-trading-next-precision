"use client";

import { Box, Typography } from "@mui/material";
import { simplifyId } from "../../volatility/LatestVolatilityPoints";
import OpenPositionFundingRate from "../OpenPositionFundingRate";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import { formatDate, formatPrice } from "./format";

export default function PositionDetailsGrid({
  position,
}: {
  position: RuntimeHistoryPosition;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          md:
            position.tradingMode === "futures"
              ? "repeat(6, minmax(0, 1fr))"
              : "repeat(5, minmax(0, 1fr))",
        },
        gap: 1.5,
        mb: 1.5,
      }}
    >
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.7rem", display: "block" }}
        >
          Entry Price
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {formatPrice(position.exposure.averageEntryPrice)}
        </Typography>
      </Box>

      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.7rem", display: "block" }}
        >
          Mark Price
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {formatPrice(position.pnl.markPrice)}
        </Typography>
      </Box>

      {position.tradingMode === "futures" && (
        <OpenPositionFundingRate
          direction={position.direction}
          funding={position.funding}
        />
      )}

      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.7rem", display: "block" }}
        >
          Trade Mode
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {position.tradingMode}
        </Typography>
      </Box>

      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.7rem", display: "block" }}
        >
          Entered At (Jakarta)
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {formatDate(position.opened.t)}
        </Typography>
      </Box>


      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.7rem", display: "block" }}
        >
          Entry ID
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {simplifyId(position.opened.vPoint.id ?? "")}
        </Typography>
      </Box>


    </Box>
  );
}
