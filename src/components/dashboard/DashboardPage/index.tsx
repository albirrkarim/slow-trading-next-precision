"use client";

import { useEffect } from "react";

import {
  Box,
  Button,
  Grid,
  LinearProgress,
  useMediaQuery,
} from "@mui/material";

import CoinTagManagerDialog from "@/components/coins/CoinTagManagerDialog";
import CoinMetadataDownloadDialog from "@/components/coins/CoinMetadataDownloadDialog";
import BinanceCooldownStatusSection from "@/components/reports/BinanceCooldownStatusSection";
import BlackSwanStatusSection from "@/components/reports/BlackSwanStatusSection";
import SystemAccountSummary from "@/components/reports/SystemAccountSummary";
import {
  computeDayPreview,
  formatDailyPnlMetaTitle,
} from "@/components/settings/helpers";
import VPointsFrequency from "@/components/charts/VPointsFrequency";
import EntryBlockers from "../entry/EntryBlockers";
import EntrySequenceMetrics from "../entry/EntrySequences";
import LatestVolatilityPoints from "../volatility/LatestVolatilityPoints";
import OpenPositions from "../positions/OpenPositions";
import QuickBacktest from "../entry/QuickBacktest";
import SlowTradingQueuesPanel from "../queues/SlowTradingQueues";
import WorkerEntrySequenceMetrics from "../entry/WorkerEntrySequenceMetrics";
import WorkerNeededEstimation from "../entry/WorkerNeededEstimation";
import LiveDashboardNavbar from "../navigation";
import PrecisionTestCaseControls from "../navigation/PrecisionTestCaseControls";

import useCoinMetadata from "./useCoinMetadata";
import useDashboardActions from "./useDashboardActions";
import useDashboardData from "./useDashboardData";
import PriceNormalizedSection from "./PriceNormalizedSection";
import VolatilitySection from "./VolatilitySection";

export type { DashboardConfig } from "./types";

export default function DynamicTradeHistoryPage({
  appName,
}: {
  appName: string;
}) {
  const isMobile = useMediaQuery("(max-width:600px)");
  const {
    accountEntryLegs,
    applyBinanceHealth,
    applyDashboardState,
    applyQuickBacktestSimulationSeries,
    config,
    currentExchangeType,
    dashboardState,
    data,
    execute,
    fundingRateBySymbol,
    loading,
    marketCapFetchedAtBySymbol,
    marketCapUSDBySymbol,
    onVolatilityVisibleRange,
    participatingAccountSlugs,
    reinitializing,
    selectedAccountSlug,
    setSelectedAccountSlug,
    setVolatilityMap,
    symbols,
    updateConfig,
    volatilityMap,
    volatilityRange,
    volume24hBySymbol,
  } = useDashboardData();
  const {
    deleteCoin,
    deletingSymbol,
    enteringSymbol,
    exitingSymbol,
    manualEntry,
    manualExit,
    resetAllVPointUsed,
    resettingVPointUsed,
  } = useDashboardActions({
    applyDashboardState,
    config,
    currentExchangeType,
    dashboardState,
    execute,
    selectedAccountSlug,
    setVolatilityMap,
    symbols,
  });
  const {
    broadcastingCoinMetadata,
    broadcastCoinMetadata,
    coinMetadata,
    createTag,
    deleteTag,
    downloadingCoinMetadata,
    downloadOnlineCoinMetadataToLocal,
    showLocalCoinMetadataSyncControls,
    tagColors,
    tagDescriptions,
    updateCoinMetadata,
    updateTag,
  } = useCoinMetadata();

  useEffect(() => {
    // PROD:DAILY_PNL_META_TITLE
    const dailyUsdtProfit = computeDayPreview(dashboardState).dailyUsdtProfit;
    document.title = formatDailyPnlMetaTitle(appName, dailyUsdtProfit);
  }, [appName, dashboardState]);

  const statusSectionsElement = dashboardState ? (
    <>
      <BlackSwanStatusSection
        onRefresh={execute}
        state={dashboardState}
      />
      <BinanceCooldownStatusSection
        onReset={applyBinanceHealth}
        state={dashboardState}
      />
      <PrecisionTestCaseControls
        activeMode={dashboardState.activeMode}
      />
    </>
  ) : null;

  const openPositionsElement = dashboardState ? (
    <OpenPositions
      accounts={participatingAccountSlugs}
      captureEntryRanAt={
        dashboardState.stats.stageRuns?.["capture-entry"]?.t
      }
      entryLegs={accountEntryLegs}
      availableTags={coinMetadata.tags.map((tag) => tag.text)}
      coinDescriptions={coinMetadata.coinDescriptions}
      coinTags={coinMetadata.coinTags}
      config={dashboardState.config}
      mode={dashboardState?.activeMode ?? "live"}
      exchangeType={currentExchangeType}
      positions={dashboardState?.openPositions ?? []}
      spendableQuoteAsset={
        dashboardState.balances.spendableQuoteAsset
      }
      strategyState={dashboardState.strategy}
      exitingSymbol={exitingSymbol}
      onCoinDescriptionChange={(symbol, description) =>
        void updateCoinMetadata(symbol, { description })
      }
      onCoinTagsChange={(symbol, tags) =>
        void updateCoinMetadata(symbol, { tags })
      }
      onExit={manualExit}
      tagColors={tagColors}
      tagDescriptions={tagDescriptions}
      volatilityMap={volatilityMap ?? {}}
      volume24hBySymbol={volume24hBySymbol}
    />
  ) : null;

  const entryInsightsElement = dashboardState && volatilityMap ? (
    <>
      <WorkerEntrySequenceMetrics
        dashboardState={dashboardState}
      />

      <EntrySequenceMetrics
        endTime={config.endTime}
        minEntryAbsLevel={
          dashboardState.config.minEntryAbsLevel
        }
        maxEntryAbsLevel={
          dashboardState.config.maxEntryAbsLevel
        }
        startTime={config.startTime}
        volatilityMap={volatilityMap}
      />

      <VPointsFrequency
        endTime={config.endTime}
        startTime={config.startTime}
        volatilityMap={volatilityMap}
      />

      <EntryBlockers />
    </>
  ) : null;

  const volatilitySection = (
    <>
      <VolatilitySection
        config={config}
        dashboardState={dashboardState}
        data={data}
        isMobile={isMobile}
        loading={loading}
        onResetVPointUsed={() => void resetAllVPointUsed()}
        onVolatilityVisibleRange={onVolatilityVisibleRange}
        resettingVPointUsed={resettingVPointUsed}
        updateConfig={updateConfig}
        volatilityRange={volatilityRange}
      />
      <PriceNormalizedSection
        config={config}
        dashboardState={dashboardState}
        isMobile={isMobile}
        onVolatilityVisibleRange={onVolatilityVisibleRange}
        symbols={symbols}
        volatilityRange={volatilityRange}
      />
    </>
  );

  return (
    <Box>
      <LiveDashboardNavbar
        dashboardState={dashboardState}
        onRefresh={execute}
        onReinitialize={() => execute(true)}
        reinitializing={reinitializing}
        selectedAccountSlug={selectedAccountSlug}
        setSelectedAccountSlug={setSelectedAccountSlug}
      />
      {(loading || reinitializing) && (
        <LinearProgress
          aria-label={
            reinitializing ? "Reinitializing dashboard" : "Loading dashboard"
          }
          color={reinitializing ? "warning" : "primary"}
          sx={{ height: 3 }}
        />
      )}

      <Box sx={{ m: 1 }}>
        {dashboardState && (
          <SystemAccountSummary
            accounts={dashboardState.accounts}
            description={dashboardState.config.description}
          />
        )}

        {!isMobile && (
          volatilitySection
        )}

        {data && dashboardState && (
          <>
            {isMobile ? (
              <>
                {statusSectionsElement}
                {openPositionsElement}

                {entryInsightsElement && (
                  <Box sx={{ my: 2 }}>
                    {entryInsightsElement}
                  </Box>
                )}

                {volatilitySection}
              </>
            ) : (
              <Grid container spacing={2}>
                <Grid size={{ xl: 9, lg: 8, md: 12, xs: 12 }}>
                  {openPositionsElement}
                </Grid>
                {entryInsightsElement && (
                  <Grid size={{ xl: 3, lg: 4, md: 12, xs: 12 }}>
                    {entryInsightsElement}
                    {statusSectionsElement}
                  </Grid>
                )}
              </Grid>
            )}

            {volatilityMap && dashboardState && (
              <Box sx={{ my: 4 }}>
                <LatestVolatilityPoints
                  availableTags={coinMetadata.tags.map((tag) => tag.text)}
                  coinDescriptions={coinMetadata.coinDescriptions}
                  coinTags={coinMetadata.coinTags}
                  dashboardState={dashboardState}
                  volatilityMap={volatilityMap}
                  decisionEngineVersion={
                    dashboardState?.config.decisionEngineVersion
                  }
                  deletingSymbol={deletingSymbol}
                  enteringSymbol={enteringSymbol}
                  onDeleteCoin={deleteCoin}
                  onManualEntry={manualEntry}
                  onCoinDescriptionChange={(symbol, description) =>
                    void updateCoinMetadata(symbol, { description })
                  }
                  onCoinTagsChange={(symbol, tags) =>
                    void updateCoinMetadata(symbol, { tags })
                  }
                  tagManagerAction={
                    <>
                      <Box>
                        {showLocalCoinMetadataSyncControls && (
                          <Button
                            disabled={
                              broadcastingCoinMetadata ||
                              downloadingCoinMetadata
                            }
                            onClick={() => void broadcastCoinMetadata()}
                            size="small"
                            variant="contained"
                            sx={{ mr: 2 }}
                          >
                            {broadcastingCoinMetadata
                              ? "Broadcasting..."
                              : "Broadcast local metadata"}
                          </Button>
                        )}
                        {showLocalCoinMetadataSyncControls && (
                          <CoinMetadataDownloadDialog
                            disabled={broadcastingCoinMetadata}
                            downloading={downloadingCoinMetadata}
                            onDownload={downloadOnlineCoinMetadataToLocal}
                          />
                        )}
                      </Box>
                      <CoinTagManagerDialog
                        onCreate={createTag}
                        onCoinTagsChange={(symbol, tags) =>
                          updateCoinMetadata(symbol, { tags })
                        }
                        onDelete={deleteTag}
                        onUpdate={updateTag}
                        state={coinMetadata}
                      />
                    </>
                  }
                  tagColors={tagColors}
                  tagDescriptions={tagDescriptions}
                  fundingRateBySymbol={fundingRateBySymbol}
                  marketCapFetchedAtBySymbol={marketCapFetchedAtBySymbol}
                  marketCapUSDBySymbol={marketCapUSDBySymbol}
                  volume24hBySymbol={volume24hBySymbol}
                  openSymbols={(dashboardState?.openPositions ?? []).map(
                    (position) => position.symbol,
                  )}
                />
              </Box>
            )}
          </>
        )}

        <Box sx={{ my: 4 }}>
          <SlowTradingQueuesPanel dashboardState={dashboardState} />
        </Box>

        {volatilityMap && dashboardState && (
          <WorkerNeededEstimation
            config={dashboardState.config}
            endTime={config.endTime}
            startTime={config.startTime}
            volume24hBySymbol={volume24hBySymbol}
            volatilityMap={volatilityMap}
          />
        )}

        {volatilityMap && dashboardState && (
          <QuickBacktest
            dashboardState={dashboardState}
            endTime={config.endTime}
            range={config.range}
            startTime={config.startTime}
            volume24hBySymbol={volume24hBySymbol}
            volatilityMap={volatilityMap}
            onSimulationSeriesChange={applyQuickBacktestSimulationSeries}
          />
        )}

      </Box>
    </Box>
  );
}
