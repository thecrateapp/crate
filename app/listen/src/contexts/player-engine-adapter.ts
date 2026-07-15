import type { Track } from "@/contexts/player-types";
import { getStreamUrl } from "@/contexts/player-utils";
import { api, ensureFreshAuthToken, resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  resolveTrackPlaybackUrl,
  type PlaybackResolution,
} from "@/lib/track-playback";
import type { EngineTrack } from "@/lib/playback-engine";
import { getPlaybackDeliveryPolicyPreference } from "@/lib/player-playback-prefs";
import { setPlaybackSession } from "@/lib/playback-provenance";

export function toEngineTrack(
  track: Track,
  eqGains?: number[],
  streamUrl?: string,
): EngineTrack {
  const artwork = resolveMaybeApiAssetUrl(track.albumCover) || undefined;

  return {
    id: track.id,
    url: streamUrl ?? getStreamUrl(track),
    title: track.title || "Unknown",
    artist: track.artist || "",
    album: track.album || undefined,
    artwork,
    durationMs:
      track.duration && track.duration > 0
        ? Math.round(track.duration * 1000)
        : undefined,
    storageId: undefined,
    entityUid: track.entityUid,
    sourcePath: track.path,
    eqGains,
  };
}

export function toEngineTracks(
  tracks: Track[],
  eqGainsByTrackId?: Map<string, number[]>,
): EngineTrack[] {
  return tracks.map((track) =>
    toEngineTrack(track, eqGainsByTrackId?.get(track.id)),
  );
}

export async function toFreshEngineTrack(
  track: Track,
  eqGains?: number[],
): Promise<EngineTrack> {
  await ensureFreshAuthToken();
  return toEngineTrack(
    track,
    eqGains,
    await resolveFreshEngineStreamUrl(track),
  );
}

export async function toFreshEngineTracks(
  tracks: Track[],
  eqGainsByTrackId?: Map<string, number[]>,
): Promise<EngineTrack[]> {
  await ensureFreshAuthToken();
  return Promise.all(
    tracks.map(async (track) =>
      toEngineTrack(
        track,
        eqGainsByTrackId?.get(track.id),
        await resolveFreshEngineStreamUrl(track),
      ),
    ),
  );
}

function hasFreshRemoteStream(track: Track): boolean {
  if (track.origin !== "remote" || !track.remote?.streamUrl) return false;
  if (!track.remote.streamUrlExpiresAt) return true;
  return new Date(track.remote.streamUrlExpiresAt).getTime() > Date.now();
}

async function resolveFreshEngineStreamUrl(track: Track): Promise<string> {
  if (hasFreshRemoteStream(track)) return getStreamUrl(track);
  if (!track.globalTrackUid) return getStreamUrl(track);

  const path = resolveTrackPlaybackUrl(
    track,
    getPlaybackDeliveryPolicyPreference(),
  );
  if (!path) return getStreamUrl(track);

  const playback = await api<PlaybackResolution>(path);
  setPlaybackSession(track, playback.playback_session);
  return resolveMaybeApiAssetUrl(playback.stream_url) || playback.stream_url;
}
