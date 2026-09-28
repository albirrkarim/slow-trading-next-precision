"use client";

import { useEffect, useMemo } from "react";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { Alert, Box, Button, CircularProgress } from "@mui/material";

import ButtonDialog from "@/components/ui/ButtonDialog";
import DailyPnlCalendarDialog, {
  buildTradePnlBalanceSnapshots,
  toDailyPnlCalendarTrade,
} from "@/components/reports/DailyPnlCalendarDialog";
import type { ConfigDraft } from "@/components/settings/settings-types";
import type { Position } from "@/lib/system/trading";

import type { LazyArtifact } from "./use-backtest-artifacts";

/** Dialog body — mounts only when the calendar opens — loads positions. */
function CalendarContent({
  positions,
  settings,
}: {
  positions: LazyArtifact<Position[]>;
  settings?: ConfigDraft;
}) {
  const { ensure } = positions;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  const history = useMemo(
    () => (positions.data ?? []).map(toDailyPnlCalendarTrade),
    [positions.data],
  );
  const startingBalanceUSDT = useMemo(
    () =>
      (settings?.accounts ?? [])
        .filter((account) => account.enabled !== false)
        .reduce(
          (total, account) =>
            total + (Number(account.sandbox?.initialBalanceUSDT) || 0),
          0,
        ),
    [settings],
  );
  const balanceSnapshots = useMemo(
    () => buildTradePnlBalanceSnapshots({ history, startingBalanceUSDT }),
    [history, startingBalanceUSDT],
  );

  if (positions.error) {
    return <Alert severity="error">{positions.error}</Alert>;
  }
  if (!positions.data) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <DailyPnlCalendarDialog
      description="Closed positions from this backtest run."
      history={history}
      balanceSnapshots={balanceSnapshots}
      startingBalanceUSDT={startingBalanceUSDT}
    />
  );
}

export default function BacktestDailyPnlCalendar(props: {
  positions: LazyArtifact<Position[]>;
  settings?: ConfigDraft;
}) {
  const { positions, settings } = props;

  return (
    <ButtonDialog
      title="Daily PnL Calendar"
      maxWidth={false}
      contentSx={{ p: { xs: 0, sm: 1 } }}
      customButton={(handleOpen) => (
        <Button
          color="inherit"
          onClick={handleOpen}
          size="small"
          startIcon={<CalendarMonthIcon />}
          variant="outlined"
        >
          Daily PnL Calendar
        </Button>
      )}
    >
      {() => (
        <CalendarContent positions={positions} settings={settings} />
      )}
    </ButtonDialog>
  );
}
