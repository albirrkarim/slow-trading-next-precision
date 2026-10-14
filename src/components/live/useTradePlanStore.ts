"use client";

import { useCallback, useState } from "react";

import tradePlan, { type TradePlan } from "@/lib/system/utils/ui/trade-plan";

const STORAGE_KEY = "precision:live-plans:v1";

/** Every coin's drawn plans, `{ [symbol]: TradePlan[] }`, from browser storage. */
function readAll(): Record<string, unknown> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function write(symbol: string, plans: TradePlan[]): void {
  try {
    const all = readAll();
    if (plans.length) all[symbol] = plans;
    else delete all[symbol];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable — plans live until the page reloads.
  }
}

export interface TradePlanStore {
  plans: TradePlan[];
  selected: TradePlan | undefined;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Replaces the coin's whole plan list (drag release). */
  setAll: (plans: TradePlan[]) => void;
  add: (plan: TradePlan) => void;
  replace: (plan: TradePlan) => void;
  remove: (id: string) => void;
}

/**
 * Visual-only trade plans for one coin, shared across intervals and markets
 * and kept in this browser only.
 */
export function useTradePlanStore(symbol: string): TradePlanStore {
  const [plans, setPlans] = useState<TradePlan[]>(() => tradePlan.sanitize(readAll()[symbol]));
  const [selectedId, select] = useState<string | null>(null);

  const setAll = useCallback(
    (next: TradePlan[]) => {
      setPlans(next);
      write(symbol, next);
    },
    [symbol],
  );

  return {
    add: (plan) => {
      setAll([...plans, plan]);
      select(plan.id);
    },
    plans,
    remove: (id) => {
      setAll(plans.filter((plan) => plan.id !== id));
      if (selectedId === id) select(null);
    },
    replace: (next) => setAll(plans.map((plan) => (plan.id === next.id ? next : plan))),
    select,
    selected: plans.find((plan) => plan.id === selectedId),
    selectedId,
    setAll,
  };
}
