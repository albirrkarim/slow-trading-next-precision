"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Box,
  Button,
  CircularProgress,
} from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import CopyToClipboardIconButton from "@/components/ui/CopyToClipboardIconButton";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import type { RuntimeEffectiveConfig } from "@/lib/system/runtime";
import { getCoinGlassLiquidationMapUrl } from "./format";
import PositionChartDialog from "./PositionChartDialog";

export default function PositionActions({
  exchangeType,
  exitingSymbol,
  onExit,
  position,
}: {
  exchangeType: RuntimeEffectiveConfig["exchangeType"];
  exitingSymbol?: string | null;
  onExit?: (position: RuntimeHistoryPosition) => Promise<void>;
  position: RuntimeHistoryPosition;
}) {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Button
        variant="outlined"
        size="small"
        color="error"
        sx={{ fontSize: "0.7rem", textTransform: "none" }}
        onClick={() => void onExit?.(position)}
        disabled={!onExit || exitingSymbol === position.symbol}
        title={`Click to close position for ${position.symbol}`}
      >
        {exitingSymbol === position.symbol ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          "Close Position"
        )}
      </Button>

      <PositionChartDialog exchangeType={exchangeType} position={position} />

      <Button
        component="a"
        href={getCoinGlassLiquidationMapUrl(position.symbol)}
        target="_blank"
        rel="noopener noreferrer"
        variant="outlined"
        size="small"
        color="secondary"
        sx={{ fontSize: "0.7rem", textTransform: "none" }}
        title={`Open the CoinGlass liquidation heatmap for ${position.symbol} in a new tab`}
        startIcon={<OpenInNewIcon fontSize="small" />}
      >
        Liquidation Map
      </Button>

      <ButtonDialog
        title="JSON"
        titleLong={`Position JSON: ${position.symbol}`}
        maxWidth="md"
        size="small"
        variant="outlined"
      >
        {() => (
          <Box sx={{ p: 2 }}>
            <CopyToClipboardIconButton
              color="inherit"
              size="small"
              tooltipTitle="Copy JSON"
              aria-label="Copy position JSON"
              text={JSON.stringify(position, null, 2)}
            />
            <Box
              component="pre"
              sx={{
                m: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "0.75rem",
              }}
            >
              {JSON.stringify(position, null, 2)}
            </Box>
          </Box>
        )}
      </ButtonDialog>
    </Box>
  );
}
