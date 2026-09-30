"use client";

import { useEffect, useMemo, useState } from "react";

import axios from "axios";
import { useSnackbar } from "notistack";

import { endpoints } from "@/components/endpoints";
import type { CoinTagState } from "@/lib/dev/coins/tag-types";
import { systemLog } from "@/lib/system/logging";

import type { TagData } from "@/components/coins/CoinTagManagerDialog";

import { EMPTY_COIN_METADATA, isCoinTagState } from "./utils";

export default function useCoinMetadata() {
  const { enqueueSnackbar } = useSnackbar();
  const [coinMetadata, setCoinMetadata] =
    useState<CoinTagState>(EMPTY_COIN_METADATA);
  const [broadcastingCoinMetadata, setBroadcastingCoinMetadata] =
    useState(false);
  const [downloadingCoinMetadata, setDownloadingCoinMetadata] = useState(false);

  useEffect(() => {
    void axios
      .get<CoinTagState>(endpoints.system.coin.metadata)
      .then((response) => {
        if (!isCoinTagState(response.data)) {
          throw new Error("Coin metadata endpoint returned an invalid response");
        }
        setCoinMetadata(response.data);
      })
      .catch((error) => systemLog.error(error));
  }, []);

  const tagDescriptions = useMemo(
    () =>
      Object.fromEntries(
        coinMetadata.tags.map((tag) => [
          tag.text.toLocaleLowerCase(),
          tag.description,
        ]),
      ),
    [coinMetadata.tags],
  );
  const tagColors = useMemo(
    () =>
      Object.fromEntries(
        coinMetadata.tags.map((tag) => [
          tag.text.toLocaleLowerCase(),
          tag.color,
        ]),
      ),
    [coinMetadata.tags],
  );
  const showLocalCoinMetadataSyncControls = useMemo(() => {
    if (typeof window === "undefined") return false;

    const origin = window.location.origin.toLocaleLowerCase();
    return (
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("http://[::1]")
    );
  }, []);

  const updateCoinMetadata = async (
    symbol: string,
    update: { description: string } | { tags: string[] },
  ) => {
    try {
      const response = await axios.put<CoinTagState>(
        endpoints.system.coin.metadata,
        {
          symbol,
          ...update,
        },
      );
      setCoinMetadata(response.data);
    } catch (error: any) {
      systemLog.error(error);
      enqueueSnackbar(
        error.response?.data?.error ?? "Failed to save coin metadata",
        { variant: "error" },
      );
    }
  };

  const downloadOnlineCoinMetadataToLocal = async (
    onlineBaseUrl: string,
  ): Promise<boolean> => {
    setDownloadingCoinMetadata(true);
    try {
      const response = await axios.post<{
        onlineBaseUrl: string;
        state: CoinTagState;
      }>(endpoints.system.debug.syncOnlineCoinMetadataToLocal, {
        onlineBaseUrl,
      });
      setCoinMetadata(response.data.state);
      enqueueSnackbar(
        `Coin metadata downloaded from ${response.data.onlineBaseUrl}`,
        { variant: "success" },
      );
      return true;
    } catch (error: any) {
      const message =
        error.response?.data?.error ??
        "Failed to download online coin metadata";
      systemLog.error(error);
      enqueueSnackbar(message, { variant: "error" });
      return false;
    } finally {
      setDownloadingCoinMetadata(false);
    }
  };

  const broadcastCoinMetadata = async () => {
    if (
      !confirm(
        "Broadcast current local coin tags and descriptions to fast.reinventwp.com, holy.reinventwp.com, and wealth.reinventwp.com?",
      )
    ) {
      return;
    }

    setBroadcastingCoinMetadata(true);
    try {
      const response = await axios.post<{
        failed: Array<{ error?: string; peer: string; status?: number }>;
        state: CoinTagState;
        succeeded: Array<{ peer: string }>;
      }>(endpoints.system.debug.broadcastCoinMetadata, {});
      setCoinMetadata(response.data.state);
      if (response.data.failed.length > 0) {
        enqueueSnackbar(
          `Coin metadata broadcast: ${response.data.succeeded.length} succeeded, ${response.data.failed.length} failed`,
          { variant: "warning" },
        );
      } else {
        enqueueSnackbar(
          `Coin metadata broadcast to ${response.data.succeeded.length} online sites`,
          { variant: "success" },
        );
      }
    } catch (error: any) {
      const message =
        error.response?.data?.error ?? "Failed to broadcast coin metadata";
      systemLog.error(error);
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setBroadcastingCoinMetadata(false);
    }
  };

  const createTag = async (tag: TagData) => {
    try {
      const response = await axios.post<CoinTagState>(
        endpoints.system.coin.metadata,
        tag,
      );
      setCoinMetadata(response.data);
    } catch (error: any) {
      const message =
        error.response?.data?.error ?? "Failed to create coin tag";
      systemLog.error(error);
      enqueueSnackbar(message, { variant: "error" });
      throw new Error(message);
    }
  };

  const updateTag = async (tag: TagData) => {
    try {
      const response = await axios.patch<CoinTagState>(
        endpoints.system.coin.metadata,
        tag,
      );
      setCoinMetadata(response.data);
    } catch (error: any) {
      const message =
        error.response?.data?.error ?? "Failed to update coin tag";
      systemLog.error(error);
      enqueueSnackbar(message, { variant: "error" });
      throw new Error(message);
    }
  };

  const deleteTag = async (tagId: number) => {
    try {
      const response = await axios.delete<CoinTagState>(
        endpoints.system.coin.metadata,
        {
          data: { tagId },
        },
      );
      setCoinMetadata(response.data);
    } catch (error: any) {
      const message =
        error.response?.data?.error ?? "Failed to delete coin tag";
      systemLog.error(error);
      enqueueSnackbar(message, { variant: "error" });
      throw new Error(message);
    }
  };

  return {
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
  };
}
