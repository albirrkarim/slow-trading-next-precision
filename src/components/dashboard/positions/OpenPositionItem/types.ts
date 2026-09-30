import type { RuntimeHistoryPosition } from "@/lib/system/trading";
import type { RuntimeEffectiveConfig } from "@/lib/system/runtime";
import type { VolatilityPoint } from "@/lib/system/types";

export interface OpenPositionItemProps {
  availableTags: string[];
  coinDescription: string;
  coinTags: string[];
  config: RuntimeEffectiveConfig;
  currentVolatilityLevel?: number;
  exchangeType: RuntimeEffectiveConfig["exchangeType"];
  pnlContributionShare: number;
  position: RuntimeHistoryPosition;
  now?: number;
  spendableQuoteAsset: number;
  exitingSymbol?: string | null;
  onCoinDescriptionChange: (symbol: string, description: string) => void;
  onCoinTagsChange: (symbol: string, tags: string[]) => void;
  onExit?: (position: RuntimeHistoryPosition) => Promise<void>;
  tagColors: Record<string, string>;
  tagDescriptions: Record<string, string>;
  volatilityPoints: VolatilityPoint[];
  volume24h?: number;
}
