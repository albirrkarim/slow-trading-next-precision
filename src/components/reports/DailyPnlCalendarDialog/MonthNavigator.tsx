"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  Box,
  IconButton,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";

import type { MonthSection } from "./types";

export function MonthNavigator(props: {
  months: MonthSection[];
  onSelect: (monthKey: string) => void;
  selectedMonth: MonthSection;
  selectedMonthIndex: number;
}) {
  const { months, onSelect, selectedMonth, selectedMonthIndex } = props;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        mb: { xs: 1, sm: 2 },
        flexWrap: "wrap",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          width: { xs: "100%", sm: "auto" },
        }}
      >
        <IconButton
          size="small"
          onClick={() =>
            onSelect(
              months[selectedMonthIndex + 1]?.monthKey ?? selectedMonth.monthKey,
            )
          }
          disabled={selectedMonthIndex >= months.length - 1}
          title="Older month"
        >
          <ChevronLeftIcon />
        </IconButton>

        <Typography
          variant="h6"
          sx={{
            flex: { xs: 1, sm: "initial" },
            minWidth: { xs: 0, sm: 180 },
            textAlign: "center",
          }}
        >
          {selectedMonth.title}
        </Typography>

        <IconButton
          size="small"
          onClick={() =>
            onSelect(
              months[selectedMonthIndex - 1]?.monthKey ?? selectedMonth.monthKey,
            )
          }
          disabled={selectedMonthIndex <= 0}
          title="Newer month"
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>

      <Select
        size="small"
        value={selectedMonth.monthKey}
        onChange={(event) => onSelect(event.target.value)}
        sx={{ display: { xs: "none", sm: "inline-flex" }, minWidth: 220 }}
      >
        {months.map((month) => (
          <MenuItem key={month.monthKey} value={month.monthKey}>
            {month.title}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
