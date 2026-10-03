"use client";

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  IconButton,
  InputAdornment,
  TextField,
} from "@mui/material";
import type { Dispatch, SetStateAction } from "react";

import CoinTagSelect from "@/components/coins/CoinTagSelect";

import type { LatestVolatilityPointControls } from "./controls";
import { SYMBOL_SEARCH_MAX_LENGTH } from "./controls";
import type { LatestVolatilityPointsProps } from "./types";

export function FilterControls(props: {
  availableTags: LatestVolatilityPointsProps["availableTags"];
  selectedTags: string[];
  setControls: Dispatch<SetStateAction<LatestVolatilityPointControls>>;
  setPage: Dispatch<SetStateAction<number>>;
  setSymbolSearchDraft: Dispatch<SetStateAction<string>>;
  symbolSearchDraft: string;
  tagColors: LatestVolatilityPointsProps["tagColors"];
  tagDescriptions: LatestVolatilityPointsProps["tagDescriptions"];
}) {
  const {
    availableTags,
    selectedTags,
    setControls,
    setPage,
    setSymbolSearchDraft,
    symbolSearchDraft,
    tagColors,
    tagDescriptions,
  } = props;

  return (
    <Box
      sx={{
        alignItems: "flex-end",
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: {
          xs: "1fr",
          md: "minmax(180px, 260px) 1fr",
        },
        mb: 1,
        maxWidth: 820,
      }}
    >
      <TextField
        fullWidth
        label="Search symbol"
        onChange={(event) => {
          setSymbolSearchDraft(
            event.target.value.slice(0, SYMBOL_SEARCH_MAX_LENGTH),
          );
        }}
        placeholder="BTC or BTC, ETH, SOL"
        size="small"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: symbolSearchDraft ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="Clear symbol search"
                  edge="end"
                  onClick={() => {
                    setSymbolSearchDraft("");
                    setPage(0);
                    setControls((current) => ({
                      ...current,
                      symbolSearch: "",
                    }));
                  }}
                  size="small"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
        value={symbolSearchDraft}
        variant="standard"
      />

      <CoinTagSelect
        allowCreate={false}
        label="Filter by tags"
        onChange={(nextTags) => {
          setPage(0);
          setControls((current) => ({
            ...current,
            selectedTags: nextTags,
          }));
        }}
        options={availableTags}
        tagColors={tagColors}
        tagDescriptions={tagDescriptions}
        value={selectedTags}
      />
    </Box>
  );
}
