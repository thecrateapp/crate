import type { Track } from "@/contexts/player-types";
import { getStreamUrl } from "@/contexts/player-utils";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import type { EngineTrack } from "@/lib/playback-engine";

export function toEngineTrack(track: Track, eqGains?: number[]): EngineTrack {
  const artwork = resolveMaybeApiAssetUrl(track.albumCover) || undefined;

  return {
    id: track.id,
    url: getStreamUrl(track),
    title: track.title || "Unknown",
    artist: track.artist || "",
    album: track.album || undefined,
    artwork,
    durationMs: track.duration && track.duration > 0 ? Math.round(track.duration * 1000) : undefined,
    storageId: undefined,
    entityUid: track.entityUid,
    sourcePath: track.path,
    eqGains,
  };
}

export function toEngineTracks(tracks: Track[], eqGainsByTrackId?: Map<string, number[]>): EngineTrack[] {
  return tracks.map((track) => toEngineTrack(track, eqGainsByTrackId?.get(track.id)));
}
