"use client";

import CoinTagSelect from "@/components/coins/CoinTagSelect";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import { EXCHANGE_COLOR_MAP } from "@/components/charts/constants";
import { NetProfitPercentHistorySparkline } from "@/components/charts/NetProfitPercentHistorySparkline";

import moment from "moment-timezone";
import SpeedIcon from "@mui/icons-material/Speed";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";

import {
  Box,
  Chip,
  TextField,
  Typography,
} from "@mui/material";
import { green, red } from "@mui/material/colors";
import { alpha } from "@mui/material/styles";
import OpenPositionLevelSequence from "../OpenPositionLevelSequence";
import openPositionDuration from "../open-position-duration";
import openPositionPnlContribution from "../open-position-pnl-contribution";
import DisplayCoinSymbol from "@/components/coins/DisplayCoin";

import type { OpenPositionItemProps } from "./types";
import { DisplayDrawdown, DisplayRunUp, MetricTooltip } from "./cells";
import {
  formatDate,
  formatLastMonitoredLabel,
  formatPercent,
  formatUsdt,
} from "./format";
import PositionActions from "./PositionActions";
import PositionDetailsGrid from "./PositionDetailsGrid";
import PositionMetricsGrid from "./PositionMetricsGrid";

export default function OpenPositionItem({
  availableTags,
  coinDescription,
  coinTags,
  config,
  currentVolatilityLevel,
  exchangeType,
  pnlContributionShare,
  position,
  now = 0,
  spendableQuoteAsset,
  exitingSymbol,
  onCoinDescriptionChange,
  onCoinTagsChange,
  onExit,
  tagColors,
  tagDescriptions,
  volatilityPoints,
  volume24h,
}: OpenPositionItemProps) {
  const profitPercent = position.pnl.netPct ?? 0;
  const lastMonitoringStage = position.lastMonitoringStage;
  const isSpeedupStage = lastMonitoringStage?.stage === "speedup";
  const monitoringReferenceTime =
    lastMonitoringStage?.lastUpdated ?? position.opened.t;
  const monitoringAgeMs = Number.isFinite(monitoringReferenceTime)
    ? Math.max(0, now - monitoringReferenceTime)
    : Number.POSITIVE_INFINITY;
  const monitoringStale = monitoringAgeMs > 10 * 60_000;
  const profitUsdt = position.pnl.netUsdt ?? 0;
  const contributionOpacity =
    openPositionPnlContribution.opacity(pnlContributionShare);
  const contributionColor = profitUsdt >= 0 ? green[600] : red[600];
  const contributionGradient =
    contributionOpacity > 0
      ? `radial-gradient(circle at 100% 100%, ${alpha(
        contributionColor,
        contributionOpacity,
      )} 0%, ${alpha(
        contributionColor,
        contributionOpacity * 0.55,
      )} 30%, transparent 70%)`
      : "none";
  const runUp = position.pnl.maxUpPct ?? 0;
  const drawdown = position.pnl.maxDownPct ?? 0;
  const maxEntryBased24HourVolPct = config.maxEntryBased24HourVolPct ?? 0.2;
  const borderColor =
    EXCHANGE_COLOR_MAP[exchangeType] ?? EXCHANGE_COLOR_MAP.tokocrypto;

  return (
    <HeaderMetrics
      headerSx={{
        backgroundImage: contributionGradient,
        p: 1,
      }}
      sx={{
        mb: 0,
        borderColor: "divider",
        borderLeft: `5px solid ${position.direction === "SHORT" ? red[500] : green[500]}`,
        bgcolor: "background.paper",
      }}
      title={
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1.5,
            width: "100%",
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              display: "flex",
              flex: "1 1 360px",
              flexWrap: "wrap",
              gap: 1,
              minWidth: 0,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: "bold",
                fontSize: "0.9rem",
                borderBottom: `5px solid ${borderColor}`,
              }}
            >
              {position.symbol}
            </Typography>

            <Chip
              label={position.account}
              size="small"
              variant="outlined"
            />

            {isSpeedupStage && (
              // PROD:SPEEDUP_STAGE
              <MetricTooltip
                title={`Speedup monitoring stage: ${lastMonitoringStage.reason}. Last updated: ${formatDate(lastMonitoringStage.lastUpdated)}`}
              >
                <Chip
                  aria-label="Speedup monitoring stage"
                  color="warning"
                  icon={<SpeedIcon />}
                  label=""
                  size="small"
                  sx={{
                    height: 18,
                    width: 24,
                    "& .MuiChip-icon": { margin: 0 },
                    "& .MuiChip-label": { display: "none" },
                  }}
                />
              </MetricTooltip>
            )}

            {monitoringStale && (
              // PROD:OPEN_POSITION_STALE_MONITORING_WARNING
              <MetricTooltip
                title={
                  lastMonitoringStage
                    ? `Last successful monitoring was ${Math.floor(
                        monitoringAgeMs / 60_000,
                      )} minutes ago at ${formatDate(lastMonitoringStage.lastUpdated)}. The position has exceeded the 10-minute health threshold.`
                    : `No successful monitoring timestamp is recorded after ${Math.floor(
                        monitoringAgeMs / 60_000,
                      )} minutes since the position opened.`
                }
              >
                <Chip
                  aria-label={formatLastMonitoredLabel(
                    lastMonitoringStage?.lastUpdated,
                  )}
                  color="error"
                  icon={<WarningAmberRoundedIcon />}
                  label={formatLastMonitoredLabel(
                    lastMonitoringStage?.lastUpdated,
                  )}
                  size="small"
                  variant="outlined"
                />
              </MetricTooltip>
            )}

            {(position.exposure.leverage ?? 1) > 1 && (
              <MetricTooltip title="Leverage multiplier used by this futures position. Size equals margin multiplied by leverage.">
                <Chip
                  label={`${position.exposure.leverage}x`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: "0.6rem",
                    bgcolor: "rgba(0,0,0,0.05)",
                  }}
                />
              </MetricTooltip>
            )}

            {position.exposure.marginUsdt && (
              <MetricTooltip title="Margin locked for this position in USDT. On futures this is smaller than Size because leverage is applied.">
                <Chip
                  label={formatUsdt(position.exposure.marginUsdt)}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: "0.6rem",
                    bgcolor: "rgba(0,0,0,0.05)",
                  }}
                />
              </MetricTooltip>
            )}

            <OpenPositionLevelSequence
              currentLevel={currentVolatilityLevel}
              direction={position.direction}
              entryLevel={position.opened.vPoint.lvl}
              entryTime={position.opened.t}
              markPrice={position.pnl.markPrice}

              spendableQuoteAsset={spendableQuoteAsset}
              volatilityPoints={volatilityPoints}
              watchState={position.strategy.averaging}
            />
          </Box>

          <Box
            sx={{
              display: "flex",
              gap: { xs: 1, md: 2 },
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              marginLeft: "auto",
            }}
          >
            <MetricTooltip
              title={
                position.opened.t
                  ? `Open for ${openPositionDuration.format(position.opened.t)}`
                  : "Open duration unavailable"
              }
            >
              <Typography
                color={
                  position.opened.t &&
                    openPositionDuration.isOlderThanDays(position.opened.t, 1)
                    ? "warning.main"
                    : undefined
                }
                variant="body2"
              >
                {position.opened.t ? moment(position.opened.t).fromNow() : "-"}
              </Typography>
            </MetricTooltip>

            <MetricTooltip
              title={`position.pnl.netUsdt. Floating gross price PnL minus estimated round-trip fees. On futures it is calculated on leveraged size, not only margin. Portfolio contribution: ${(
                pnlContributionShare * 100
              ).toFixed(1)}% of total absolute open-position PnL.`}
            >
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "0.7rem",
                    fontWeight: "bold",
                    color: profitUsdt >= 0 ? "success.main" : "error.main",
                  }}
                >
                  $ {formatUsdt(profitUsdt)}
                </Typography>
              </Box>
            </MetricTooltip>

            <MetricTooltip title="position.pnl.netPct. Floating price move after estimated round-trip fee percent. For futures this percent is the price move, while USDT PnL is amplified by leverage through position size.">
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    color: profitPercent >= 0 ? "success.main" : "error.main",
                  }}
                >
                  {formatPercent(profitPercent)}
                </Typography>
              </Box>
            </MetricTooltip>

            <MetricTooltip title="Max run-up observed for this open position from position.pnl.history. It uses the same fee-aware floating PnL observations.">
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  variant="body2"
                  sx={{ fontSize: "0.75rem!important", fontWeight: "bold" }}
                >
                  UP <DisplayRunUp num={runUp} />
                </Typography>
              </Box>
            </MetricTooltip>

            <MetricTooltip title="Max drawdown observed for this open position from position.pnl.history. It is the worst fee-aware floating PnL percent seen so far.">
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  variant="body2"
                  sx={{ fontSize: "0.75rem!important", fontWeight: "bold" }}
                >
                  DD <DisplayDrawdown num={drawdown} />
                </Typography>
              </Box>
            </MetricTooltip>
          </Box>
        </Box>
      }
    >
      {(expanded) =>
        expanded ? (
          <Box sx={{ px: 1, pt: 1, pb: 1.5 }}>
            <DisplayCoinSymbol
              symbol={position.symbol}
              onlyLink
            />

            <Box sx={{ mt: 1 }}>
              <NetProfitPercentHistorySparkline
                history={position.pnl.history ?? []}
              />
            </Box>

            <PositionMetricsGrid
              maxEntryBased24HourVolPct={maxEntryBased24HourVolPct}
              position={position}
              volume24h={volume24h}
            />

            <PositionDetailsGrid position={position} />

            <Box
              sx={{
                alignItems: "flex-start",
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(220px, 0.85fr) minmax(280px, 1.5fr)",
                },
                mb: 1.5,
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: "0.7rem", display: "block", mb: 0.25 }}
                >
                  Tags
                </Typography>
                <CoinTagSelect
                  label=""
                  onChange={(tags) => onCoinTagsChange(position.symbol, tags)}
                  options={availableTags}
                  tagColors={tagColors}
                  tagDescriptions={tagDescriptions}
                  value={coinTags}
                />
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: "0.7rem", display: "block", mb: 0.25 }}
                >
                  Description
                </Typography>
                <TextField
                  defaultValue={coinDescription}
                  fullWidth
                  minRows={2}
                  multiline
                  onBlur={(event) => {
                    const normalized = event.target.value.trim();
                    if (normalized !== coinDescription) {
                      onCoinDescriptionChange(position.symbol, normalized);
                    }
                  }}
                  placeholder="Notes"
                  size="small"
                  slotProps={{ htmlInput: { maxLength: 1_000 } }}
                  variant="standard"
                />
              </Box>
            </Box>

            <PositionActions
              exchangeType={exchangeType}
              exitingSymbol={exitingSymbol}
              onExit={onExit}
              position={position}
            />

          </Box>
        ) : null
      }
    </HeaderMetrics>
  );
}
