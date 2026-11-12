import type { TFunction } from "i18next";

import { api, ApiError } from "@/lib/api";

/** A playlist's Smart Mix state, as playlist responses carry it (STEM-D2). */
export interface PlaylistSmartMix {
  enabled: boolean;
  /** Local tracks with stems, of ``total``, while it is on. */
  ready: number;
  total: number;
}

/** The 409 a Smart Mix limit answers with: the server's settings, not a guess. */
export interface SmartMixLimit {
  limit: "playlist" | "user";
  maxTracks: number;
  tracks: number;
}

export function setPlaylistSmartMix(playlistId: number, enabled: boolean) {
  return api(`/api/smart-mix/playlists/${playlistId}`, "PUT", { enabled });
}

/** The limit of a refused Smart Mix change, or null for any other error. */
export function smartMixLimit(error: unknown): SmartMixLimit | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  try {
    const body = JSON.parse(error.message) as Partial<SmartMixLimit>;
    if (
      (body.limit === "playlist" || body.limit === "user") &&
      Number.isInteger(body.maxTracks) &&
      Number.isInteger(body.tracks)
    ) {
      return {
        limit: body.limit,
        maxTracks: body.maxTracks as number,
        tracks: body.tracks as number,
      };
    }
  } catch {
    // Not the structured body: an older server, or another conflict.
  }
  return null;
}

/** The translated toast for a refused Smart Mix change. */
export function smartMixLimitMessage(
  limit: SmartMixLimit,
  name: string,
  t: TFunction,
): { title: string; description: string } {
  const values = { name, maxTracks: limit.maxTracks, tracks: limit.tracks };
  return {
    title: t("actions.playlist.toasts.smartMixLimitTitle", { name }),
    description:
      limit.limit === "playlist"
        ? t("actions.playlist.toasts.smartMixPlaylistLimit", values)
        : t("actions.playlist.toasts.smartMixUserLimit", values),
  };
}
