"use client";

import axios from "axios";
import { useCallback, useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { RuntimeEntryDiagnosticsSnapshot } from "@/lib/system/trading";

interface EntryDiagnosticsStore {
  snapshot?: RuntimeEntryDiagnosticsSnapshot;
  loading: boolean;
  error: string;
}

/**
 * Module-level store: every subscriber shares one snapshot and one
 * in-flight request; `refresh()` re-fetches for all subscribers.
 */
let store: EntryDiagnosticsStore = { error: "", loading: true };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

async function request(): Promise<void> {
  if (inFlight) return inFlight;
  store = { ...store, error: "", loading: true };
  notify();
  inFlight = (async () => {
    try {
      const response =
        await axios.get<RuntimeEntryDiagnosticsSnapshot>(
          endpoints.system.manual.diagnostics,
        );
      store = { error: "", loading: false, snapshot: response.data };
    } catch (error: any) {
      store = {
        error:
          error?.response?.data?.error ?? "Could not load entry decisions.",
        loading: false,
        snapshot: store.snapshot,
      };
    } finally {
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
}

/** Re-fetches the snapshot shared by entry cards and the decisions panel. */
export const entryDiagnosticsStore = { refresh: request } as const;

/** Shared entry-diagnostics snapshot with one fetch behind all subscribers. */
export function useEntryDiagnostics() {
  const [local, setLocal] = useState(store);

  useEffect(() => {
    const listener = () => setLocal({ ...store });
    listeners.add(listener);
    void request();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(() => entryDiagnosticsStore.refresh(), []);

  return {
    error: local.error,
    loading: local.loading,
    refresh,
    snapshot: local.snapshot,
  };
}
