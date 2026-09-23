import type { ExchangeAccountSlug } from "@/lib/exchange/account-context";
import type { RuntimeMode } from "../storage/runtime";

export type RuntimeQueueKind = "safe_haven" | "withdrawal";

/** Shared debugging state stored for every pending queue item. */
export interface RuntimeQueueItemBase {
  /** Stable queue id used by dashboard cancellation. */
  id: string;
  /** Queue creation timestamp in milliseconds. */
  createdAt: number;
  /** Latest time the runner tried this queue item. */
  lastAttemptAt?: number;
  /** Earliest time the runner will try this queue item again. */
  nextAttemptAt: number;
  /** Latest human-readable attempt result. */
  lastMessage: string;
}

/** Pending monthly movement from trading capital into Safe Haven. */
export interface RuntimeSafeHavenQueueItem extends RuntimeQueueItemBase {
  /** Queue discriminator. */
  kind: "safe_haven";
  /** Immutable account slug whose mode state owns this queue item. */
  account: ExchangeAccountSlug;
  /** Runtime mode whose virtual balance this queue item updates. */
  mode: RuntimeMode;
  /** UTC month handled by this queue item, formatted as YYYY-MM. */
  period: string;
  /** Schedule that created this item; absent for manual items. */
  scheduleId?: string;
  /** Schedule name captured for dashboard debugging. */
  scheduleName?: string;
  /** Original Safe Haven amount requested for the month. */
  requestedUSDT: number;
  /** Amount still waiting to move into Safe Haven. */
  remainingUSDT: number;
}

/** Pending scheduled external USDT withdrawal. */
export interface RuntimeWithdrawalQueueItem extends RuntimeQueueItemBase {
  /** Queue discriminator. */
  kind: "withdrawal";
  /** Immutable account slug used for execution and retries. */
  account: ExchangeAccountSlug;
  /** Recurring withdrawal schedule that created this item. */
  scheduleId: string;
  /** Schedule name captured for dashboard debugging. */
  scheduleName: string;
  /** Full automatic withdrawal amount. */
  amountUSDT: number;
  /** Target withdrawal network. */
  targetNetwork: string;
  /** Target external wallet address. */
  targetWalletAddress: string;
  /** Stable exchange request id reused by retries. */
  clientWithdrawId: string;
}

/** Any pending queue item returned by manual queue creation. */
export type RuntimeQueueItem =
  | RuntimeSafeHavenQueueItem
  | RuntimeWithdrawalQueueItem;

/** Dashboard request for manually creating one production queue item. */
export type RuntimeManualQueueCreateInput =
  | {
      /** Creates a partial-capable Safe Haven queue item. */
      kind: "safe_haven";
      /** Total Safe Haven amount requested by the user. */
      amountUSDT: number;
    }
  | {
      /** Creates an all-or-nothing withdrawal queue item. */
      kind: "withdrawal";
      /** Existing withdrawal schedule used by the queue item. */
      scheduleId: string;
    };

/** Persistent Safe Haven and withdrawal queue collections. */
export interface RuntimeQueues {
  /** Pending monthly Safe Haven requests. */
  safeHaven: RuntimeSafeHavenQueueItem[];
  /** Pending recurring withdrawal requests. */
  withdrawals: RuntimeWithdrawalQueueItem[];
}
