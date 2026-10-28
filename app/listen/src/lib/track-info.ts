import type { Track } from "@/contexts/player-types";
import { trackInfoApiPath } from "@/lib/library-routes";
export * from "./track-info-data";

export function resolveTrackInfoUrl(
  track: Pick<
    Track,
    "id" | "globalTrackUid" | "entityUid" | "libraryTrackId" | "path"
  >,
): string | null {
  const path = trackInfoApiPath(track);
  return path || null;
}
