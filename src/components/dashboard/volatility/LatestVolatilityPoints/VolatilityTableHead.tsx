"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import {
  Box,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from "@mui/material";

import type {
  getLatestVolatilityPointColumnHelp,
  SortDirection,
  SortKey,
} from "./columns";
import { COLUMNS } from "./columns";

type ColumnHelpEntry = ReturnType<
  typeof getLatestVolatilityPointColumnHelp
>[number];

export function VolatilityTableHead(props: {
  columnHelpByKey: Map<string, ColumnHelpEntry>;
  onSort: (nextKey: SortKey) => void;
  resolvedMaxEntryAbsLevel: number | undefined;
  resolvedMinEntryAbsLevel: number | undefined;
  sortDirection: SortDirection;
  sortKey: SortKey;
}) {
  const {
    columnHelpByKey,
    onSort,
    resolvedMaxEntryAbsLevel,
    resolvedMinEntryAbsLevel,
    sortDirection,
    sortKey,
  } = props;

  return (
    <TableHead>
      <TableRow>
        {COLUMNS.map((column) => {
          const label =
            column.key === "entrySequence"
              ? `Entry sequences (${resolvedMinEntryAbsLevel === undefined ? "no min" : `abs >= ${resolvedMinEntryAbsLevel}`}${resolvedMaxEntryAbsLevel === undefined ? "" : `, abs <= ${resolvedMaxEntryAbsLevel}`})`
              : column.label;
          const help = columnHelpByKey.get(column.key);
          const accessibleHelp = help
            ? `${label}. Meaning: ${help.meaning} Source: ${help.source}`
            : label;

          return (
            <TableCell key={column.key} width={column.width}>
              <Tooltip
                arrow
                enterTouchDelay={0}
                title={
                  help && (
                    <Box sx={{ maxWidth: 360, py: 0.5 }}>
                      <Typography
                        component="p"
                        sx={{ fontSize: "inherit", mb: 0.75 }}
                      >
                        <strong>Meaning:</strong> {help.meaning}
                      </Typography>
                      <Typography
                        component="p"
                        sx={{ fontSize: "inherit" }}
                      >
                        <strong>Source:</strong> {help.source}
                      </Typography>
                    </Box>
                  )
                }
              >
                <TableSortLabel
                  active={sortKey === column.key}
                  aria-label={accessibleHelp}
                  direction={
                    sortKey === column.key
                      ? sortDirection
                      : "asc"
                  }
                  onClick={() => onSort(column.key)}
                >
                  {label}
                  <HelpOutlineIcon
                    aria-hidden
                    sx={{
                      color: "text.secondary",
                      fontSize: 16,
                      ml: 0.5,
                    }}
                  />
                </TableSortLabel>
              </Tooltip>
            </TableCell>
          );
        })}
      </TableRow>
    </TableHead>
  );
}
