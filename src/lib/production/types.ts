import type { FetchKlinesFunction } from "@/lib/datasets/type";
import type { IExchange } from "@/lib/exchange";
import type {
  RuntimeClock,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";

/** Dependencies used to build the production environment adapter. */
export interface ProductionAdapterOptions {
  /** Exchange instance already bound to the production account context. */
  exchange: IExchange;
  /** Clock supplied by the production runtime lifecycle. */
  clock: RuntimeClock;
  /** Stops new market reads when the runtime is shutting down. */
  signal?: AbortSignal;
  /** Final strategy approval before an action is submitted. */
  onStrategy: RuntimeEngineAdapter["onStrategy"];
  /** Submits or simulates an approved production action. */
  onAction: RuntimeEngineAdapter["onAction"];
  /** Persists a closed position after the shared runtime confirms an exit. */
  onExit: RuntimeEngineAdapter["onExit"];
  /** Persists account state after the shared runtime updates balances. */
  onStateChange?: RuntimeEngineAdapter["onStateChange"];
  /** Receives each newly detected vPoint for production persistence. */
  onNewVPoint?: RuntimeEngineAdapter["onNewVPoint"];
  /** Optional notification delivery hook. */
  onNotif?: RuntimeEngineAdapter["onNotif"];
  /** Optional account-aware balance reader used by runtime refreshes. */
  getBalance?: (
    accountSlug?: string,
  ) => number | Promise<number>;
}

/** Minimum state required before a production runtime can be started. */
export interface ProductionStateOptions
  extends Pick<
    RuntimeEngineState,
    "config" | "balance" | "openPositions"
  > {
  /** Live exchange or sandbox mode. */
  mode: Extract<RuntimeEngineState["mode"], "live" | "sandbox">;
  /** Optional initial logical time; defaults to the wall clock. */
  currentTime?: number;
  /** Existing detector memory captured before the runtime starts. */
  vPointsMap?: RuntimeEngineState["vPointsMap"];
  /** Existing latest prices captured before the runtime starts. */
  markPriceMap?: RuntimeEngineState["markPriceMap"];
}

/** Production market reader after adapting the exchange API to runtime requests. */
export interface ProductionMarket {
  getKlines: FetchKlinesFunction;
}

/** Factory input for a managed production runtime instance. */
export interface ProductionRuntimeFactory {
  createState: () => Promise<RuntimeEngineState> | RuntimeEngineState;
  createAdapter: (params: {
    signal: AbortSignal;
    state: RuntimeEngineState;
  }) => Promise<RuntimeEngineAdapter> | RuntimeEngineAdapter;
}
