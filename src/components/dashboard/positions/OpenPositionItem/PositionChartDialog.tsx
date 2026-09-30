"use client";

import ShowChartIcon from "@mui/icons-material/ShowChart";
import { Box, Button, Typography } from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import TradeChartBase from "@/components/charts/TradeChartBase";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import type { RuntimeEffectiveConfig } from "@/lib/system/runtime";

export default function PositionChartDialog({
  exchangeType,
  position,
}: {
  exchangeType: RuntimeEffectiveConfig["exchangeType"];
  position: RuntimeHistoryPosition;
}) {
  return (
    <ButtonDialog
      title="View Chart"
      titleLong={`${position.symbol} — Trade Chart`}
      maxWidth="xl"
      size="small"
      variant="outlined"
      customButton={(handleOpen) => (
        <Button
          variant="outlined"
          size="small"
          color="primary"
          sx={{ fontSize: "0.7rem", textTransform: "none" }}
          onClick={handleOpen}
          title={`View chart for ${position.symbol}`}
          startIcon={<ShowChartIcon fontSize="small" />}
        >
          View Chart
        </Button>
      )}
    >
      {() => (
        <Box sx={{ p: 1, backgroundColor: "background.default" }}>
          <TradeChartBase
            activePosition={position}
            defaultInterval="1m"
            symbol={position.symbol}
            exchange={exchangeType}
            marketType={
              (position.tradingMode?.toUpperCase() as any) ??
              (exchangeType === "tokocrypto" ? "SPOT" : "FUTURES")
            }
            markers={[]}
            volatilitySource="storage"
            header={
              <>
                <Typography variant="body2">
                  <strong>Entry:</strong>{" "}
                  {position.exposure.averageEntryPrice?.toFixed(6)} @{" "}
                  {position.opened.t
                    ? new Date(position.opened.t).toLocaleString()
                    : "—"}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color:
                      (position.pnl.netPct ?? 0) >= 0
                        ? "success.main"
                        : "error.main",
                    fontWeight: "bold",
                  }}
                >
                  PnL:{" "}
                  {(position.pnl.netPct ?? 0) >= 0 ? "+" : ""}
                  {(position.pnl.netPct ?? 0).toFixed(2)}% ($
                  {(position.pnl.netUsdt ?? 0).toFixed(2)})
                </Typography>
              </>
            }
          />
        </Box>
      )}
    </ButtonDialog>
  );
}
