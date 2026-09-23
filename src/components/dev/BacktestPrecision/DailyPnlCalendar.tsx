"use client";

import { useMemo } from "react";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { Button } from "@mui/material";

import ButtonDialog from "@/components/ui/ButtonDialog";
import DailyPnlCalendarDialog, {
  buildTradePnlBalanceSnapshots,
  toDailyPnlCalendarTrade,
} from "@/components/LiveDashboard/Shared/DailyPnlCalendarDialog";
import type { ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";
import type { Position } from "@/lib/system/trading";

export default function BacktestDailyPnlCalendar(props: {
  positions: Position[];
  settings?: ConfigDraft;
}) {
  const { positions, settings } = props;
  const history = useMemo(
    () => positions.map(toDailyPnlCalendarTrade),
    [positions],
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
        <DailyPnlCalendarDialog
          description="Closed positions from this backtest run."
          history={history}
          balanceSnapshots={balanceSnapshots}
          startingBalanceUSDT={startingBalanceUSDT}
        />
      )}
    </ButtonDialog>
  );
}
