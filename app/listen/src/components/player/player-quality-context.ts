import { createContext } from "react";
import type { TrackQualityParts } from "../../lib/track-info-data";
import type { QualityBadge } from "./bar/player-bar-utils";
/** The display quality already resolved by PlayerBar; portals retain this context. */
export interface PlayerQualityPresentation {
  trackId: string;
  badge: QualityBadge | null;
  origin: "source" | "stream";
  source?: TrackQualityParts;
}
export const PlayerQualityContext =
  createContext<PlayerQualityPresentation | null>(null);
