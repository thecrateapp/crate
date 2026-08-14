import type { PlaySource, Track } from "@/contexts/player-types";
import {
  getOfflineStreamUrl,
  getStreamUrl,
  type StreamUrlOptions,
} from "@/contexts/player-utils";
import {
  api,
  ensureFreshAuthToken,
  ensureMediaAccessUrl,
  getApiBase,
  getAuthToken,
  refreshMediaAccessTickets,
  resolveMaybeApiAssetUrl,
  resolveMaybeApiStreamUrl,
} from "@/lib/api";
import { fetchTrackPlayback } from "@/lib/track-playback";
import type {
  EngineQueueSnapshot,
  EngineRepeatMode,
  EngineTrack,
} from "@/lib/playback-engine";
import { getEffectivePlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import {
  setPlaybackDeliveryProvenance,
  setPlaybackSession,
} from "@/lib/playback-provenance";
import {
  getSmartMixCapabilities,
  SmartMixTransitionPlanner,
} from "@/lib/smart-mix";

const smartMixTransitionPlanner = new SmartMixTransitionPlanner(api);

export interface StartupEngineQueueOptions {
  revision: string;
  tracks: Track[];
  currentIndex: number;
  positionMs: number;
  autoplay: boolean;
  repeat: EngineRepeatMode;
  crossfadeMs: number;
  volume: number;
  playSource: PlaySource | null;
  shuffle: boolean;
  target: NonNullable<StreamUrlOptions["target"]>;
  eqGainsByTrackId?: Map<string, number[]>;
  offline?: boolean;
}

export function toEngineTrack(
  track: Track,
  eqGains?: number[],
  streamUrl?: string,
  options: StreamUrlOptions = {},
): EngineTrack {
  const artwork = resolveMaybeApiAssetUrl(track.albumCover) || undefined;
  const resolvedUrl = streamUrl ?? getStreamUrl(track, options);
  const androidNativeHttp =
    options.target === "android-native" &&
    isTrustedNativeApiUrl(resolvedUrl, getApiBase());

  return {
    id: track.id,
    url: androidNativeHttp ? withoutCredentialQuery(resolvedUrl) : resolvedUrl,
    authorization: androidNativeHttp ? bearerAuthorizationHeader() : undefined,
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

function isTrustedNativeApiUrl(url: string, apiBase: string): boolean {
  try {
    const parsed = new URL(url);
    const configuredApi = new URL(apiBase);
    if (
      parsed.origin !== configuredApi.origin ||
      !parsed.pathname.startsWith("/api/")
    ) {
      return false;
    }
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function withoutCredentialQuery(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    return parsed.toString();
  } catch {
    return url
      .replace(/([?&])token=[^&]*&?/g, (_match, separator) =>
        separator === "?" ? "?" : "",
      )
      .replace(/([?&])media_ticket=[^&]*&?/g, (_match, separator) =>
        separator === "?" ? "?" : "",
      )
      .replace(/[?&]$/, "");
  }
}

function bearerAuthorizationHeader(): string | undefined {
  const token = getAuthToken();
  return token ? `Bearer ${token}` : undefined;
}

export function toEngineTracks(
  tracks: Track[],
  eqGainsByTrackId?: Map<string, number[]>,
  options: StreamUrlOptions = {},
): EngineTrack[] {
  return tracks.map((track) =>
    toEngineTrack(track, eqGainsByTrackId?.get(track.id), undefined, options),
  );
}

export async function toFreshEngineTrack(
  track: Track,
  eqGains?: number[],
  options: StreamUrlOptions = {},
): Promise<EngineTrack> {
  await ensureFreshAuthToken();
  return toEngineTrack(
    track,
    eqGains,
    await resolveFreshEngineStreamUrl(track, options),
    options,
  );
}

export async function toFreshEngineTracks(
  tracks: Track[],
  eqGainsByTrackId?: Map<string, number[]>,
  options: StreamUrlOptions = {},
): Promise<EngineTrack[]> {
  await ensureFreshAuthToken();
  return Promise.all(
    tracks.map(async (track) =>
      toEngineTrack(
        track,
        eqGainsByTrackId?.get(track.id),
        await resolveFreshEngineStreamUrl(track, options),
        options,
      ),
    ),
  );
}

export async function toStartupEngineTracks(
  tracks: Track[],
  activeIndex: number,
  eqGainsByTrackId?: Map<string, number[]>,
  options: StreamUrlOptions = {},
): Promise<EngineTrack[]> {
  await ensureFreshAuthToken();
  return resolveStartupEngineTracks(
    tracks,
    activeIndex,
    eqGainsByTrackId,
    options,
  );
}

async function resolveStartupEngineTracks(
  tracks: Track[],
  activeIndex: number,
  eqGainsByTrackId?: Map<string, number[]>,
  options: StreamUrlOptions = {},
): Promise<EngineTrack[]> {
  if (options.target === "android-native") {
    await refreshNativeArtworkTickets(tracks);
  }
  const engineTracks = toEngineTracks(tracks, eqGainsByTrackId, options);
  const normalizedIndex = Math.max(
    0,
    Math.min(Math.trunc(activeIndex), tracks.length - 1),
  );
  const startupIndices = new Set([
    normalizedIndex,
    Math.min(normalizedIndex + 1, tracks.length - 1),
  ]);
  await Promise.all(
    Array.from(startupIndices).map(async (index) => {
      const track = tracks[index];
      if (!track) return;
      engineTracks[index] = toEngineTrack(
        track,
        eqGainsByTrackId?.get(track.id),
        await resolveFreshEngineStreamUrl(track, options),
        options,
      );
    }),
  );
  return engineTracks;
}

export async function toStartupEngineQueueSnapshot(
  options: StartupEngineQueueOptions,
): Promise<EngineQueueSnapshot> {
  const streamOptions = { target: options.target };
  await ensureFreshAuthToken();
  const transitionPlansPromise =
    options.target === "android-native"
      ? smartMixTransitionPlanner.plan({
          revision: options.revision,
          tracks: options.tracks,
          currentIndex: options.currentIndex,
          playSource: options.playSource,
          shuffle: options.shuffle,
          offline:
            options.offline ??
            hasOfflineTransitionWindow(
              options.tracks,
              options.currentIndex,
              streamOptions,
            ),
          preferredDurationMs: options.crossfadeMs,
          capabilities: getSmartMixCapabilities(),
        })
      : Promise.resolve(undefined);
  const [engineTracks, transitionPlans] = await Promise.all([
    resolveStartupEngineTracks(
      options.tracks,
      options.currentIndex,
      options.eqGainsByTrackId,
      streamOptions,
    ),
    transitionPlansPromise,
  ]);

  return {
    revision: options.revision,
    tracks: engineTracks,
    currentIndex: options.currentIndex,
    positionMs: options.positionMs,
    autoplay: options.autoplay,
    repeat: options.repeat,
    crossfadeMs: options.crossfadeMs,
    volume: options.volume,
    transitionPlans,
  };
}

function hasOfflineTransitionWindow(
  tracks: Track[],
  currentIndex: number,
  options: StreamUrlOptions,
): boolean {
  const start = Math.max(0, Math.trunc(currentIndex));
  const window = tracks.slice(start, start + 3);
  return (
    window.length > 0 &&
    window.every((track) => getOfflineStreamUrl(track, options) !== null)
  );
}

async function refreshNativeArtworkTickets(tracks: Track[]): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) return;
  let apiOrigin: string;
  try {
    apiOrigin = new URL(apiBase).origin;
  } catch {
    return;
  }

  const targets = new Map<string, { audience: "artwork"; path: string }>();
  for (const track of tracks) {
    if (!track.albumCover) continue;
    try {
      const artwork = new URL(track.albumCover, apiBase);
      if (
        artwork.origin === apiOrigin &&
        artwork.pathname.startsWith("/api/")
      ) {
        targets.set(artwork.pathname, {
          audience: "artwork",
          path: artwork.pathname,
        });
      }
    } catch {
      // Invalid artwork is left to the visual placeholder.
    }
  }

  const pending = Array.from(targets.values());
  for (let index = 0; index < pending.length; index += 128) {
    await refreshMediaAccessTickets(pending.slice(index, index + 128)).catch(
      () => false,
    );
  }
}

function hasFreshRemoteStream(track: Track): boolean {
  if (track.origin !== "remote" || !track.remote?.streamUrl) return false;
  if (!track.remote.streamUrlExpiresAt) return true;
  return new Date(track.remote.streamUrlExpiresAt).getTime() > Date.now();
}

async function resolveFreshEngineStreamUrl(
  track: Track,
  options: StreamUrlOptions,
): Promise<string> {
  const offlineUrl = getOfflineStreamUrl(track, options);
  if (offlineUrl) return offlineUrl;
  let resolvedUrl: string;
  if (hasFreshRemoteStream(track) || !track.globalTrackUid) {
    resolvedUrl = getStreamUrl(track, options);
  } else {
    const playback = await fetchTrackPlayback(
      track,
      getEffectivePlaybackDeliveryPolicy(),
    );
    if (!playback) {
      resolvedUrl = getStreamUrl(track, options);
    } else {
      setPlaybackSession(track, playback.playback_session);
      setPlaybackDeliveryProvenance(track, playback);
      resolvedUrl =
        resolveMaybeApiStreamUrl(playback.stream_url) || playback.stream_url;
    }
  }
  if (options.target === "android-native") return resolvedUrl;
  return ensureMediaAccessUrl(resolvedUrl, "stream");
}
