import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";

interface RemotePlaybackResponse {
  stream_url: string;
  expires_at?: string;
  delivery_policy?: string;
  playback_session: string;
  content_origin: "remote";
}

interface RemotePlaybackCacheEntry {
  streamUrl: string;
  streamUrlExpiresAt?: string;
  playbackSession: string;
}

const remotePlaybackCache = new Map<string, RemotePlaybackCacheEntry>();
const remotePlaybackInflight = new Map<
  string,
  Promise<RemotePlaybackCacheEntry>
>();

function hasFreshRemoteStream(track: Track): boolean {
  if (track.origin !== "remote" || !track.remote?.streamUrl) return false;
  if (!track.remote.streamUrlExpiresAt) return true;
  return new Date(track.remote.streamUrlExpiresAt).getTime() > Date.now();
}

function isFreshCacheEntry(
  entry: RemotePlaybackCacheEntry | undefined,
): entry is RemotePlaybackCacheEntry {
  if (!entry) return false;
  if (!entry.streamUrlExpiresAt) return true;
  return new Date(entry.streamUrlExpiresAt).getTime() > Date.now();
}

function remotePlaybackCacheKey(track: Track): string | null {
  if (!track.remote?.nodeUid || !track.remote.remoteEntityUid) return null;
  return `${track.remote.nodeUid}:${track.remote.remoteEntityUid}`;
}

export async function resolveRemotePlayableTrack(track: Track): Promise<Track> {
  if (track.origin !== "remote") return track;
  if (hasFreshRemoteStream(track)) return track;
  if (!track.remote?.nodeUid || !track.remote.remoteEntityUid) {
    throw new Error("Remote track is missing node or entity reference");
  }

  const cacheKey = remotePlaybackCacheKey(track);
  const cached = cacheKey ? remotePlaybackCache.get(cacheKey) : undefined;
  if (isFreshCacheEntry(cached)) {
    return {
      ...track,
      remote: {
        ...track.remote,
        streamUrl: cached.streamUrl,
        streamUrlExpiresAt: cached.streamUrlExpiresAt,
        playbackSession: cached.playbackSession,
      },
    };
  }

  const nodeUid = encodeURIComponent(track.remote.nodeUid);
  const remoteEntityUid = encodeURIComponent(track.remote.remoteEntityUid);
  const requestPath = `/api/federation/remote/nodes/${nodeUid}/tracks/${remoteEntityUid}/playback`;
  const response =
    cacheKey && remotePlaybackInflight.get(cacheKey)
      ? await remotePlaybackInflight.get(cacheKey)!
      : await (() => {
          const pending = api<RemotePlaybackResponse>(requestPath, "POST")
            .then((payload) => ({
              streamUrl: payload.stream_url,
              streamUrlExpiresAt: payload.expires_at,
              playbackSession: payload.playback_session,
            }))
            .then((entry) => {
              if (cacheKey) remotePlaybackCache.set(cacheKey, entry);
              return entry;
            })
            .finally(() => {
              if (cacheKey) remotePlaybackInflight.delete(cacheKey);
            });
          if (cacheKey) remotePlaybackInflight.set(cacheKey, pending);
          return pending;
        })();

  return {
    ...track,
    remote: {
      ...track.remote,
      streamUrl: response.streamUrl,
      streamUrlExpiresAt: response.streamUrlExpiresAt,
      playbackSession: response.playbackSession,
    },
  };
}
