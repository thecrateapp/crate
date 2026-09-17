import type { Track } from "@/contexts/player-types";
import { apiUrl, ensureMediaAccessUrl } from "@/lib/api";
import type {
  CastMediaResponse,
  CastPlaybackSessionResponse,
  CastStartPayload,
  CastTicketRequest,
  CastTicketResponse,
  ChromeCastImage,
  ChromeCastLoadRequest,
  ChromeCastMediaInfo,
  ChromeCastMusicMetadata,
  ChromeCastNamespace,
  NativeCastMediaPayload,
  NativeCastQueuePayload,
  WebCastQueueLoad,
} from "./cast-sender-types";

export const DEFAULT_CAST_TARGET_ID = "google-cast:default";
export const DEFAULT_RECEIVER_CAPABILITIES = {
  formats: ["mp3", "aac", "m4a"],
  content_types: ["audio/mpeg", "audio/aac", "audio/mp4"],
};

function receiverArtworkUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:")
  ) {
    return undefined;
  }
  if (url.startsWith("/api/")) return apiUrl(url);
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return undefined;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return undefined;
  }
}

export async function resolveCastArtworkUrl(
  url: string | null | undefined,
  streamUrl?: string,
): Promise<string | undefined> {
  const receiverUrl = receiverArtworkUrl(url);
  if (!receiverUrl) return undefined;
  try {
    const authorizedUrl = await ensureMediaAccessUrl(receiverUrl, "artwork");
    if (!streamUrl) return authorizedUrl;

    const browserOrigin =
      typeof window === "undefined" ? undefined : window.location.origin;
    const artwork = new URL(authorizedUrl, browserOrigin);
    const apiOrigin = new URL(apiUrl("/"), browserOrigin).origin;
    if (artwork.origin !== apiOrigin) return authorizedUrl;

    const streamOrigin = new URL(streamUrl).origin;
    const receiverArtwork = new URL(
      artwork.pathname + artwork.search,
      streamOrigin,
    );
    return receiverArtwork.href;
  } catch {
    return undefined;
  }
}

function mediaDurationSeconds(
  media: CastMediaResponse,
  track: Track,
): number | undefined {
  if (typeof media.duration_ms === "number" && media.duration_ms > 0) {
    return media.duration_ms / 1000;
  }
  if (typeof track.duration === "number" && track.duration > 0) {
    return track.duration;
  }
  return undefined;
}

export async function resolveCastMedia(
  ticket: CastTicketResponse,
): Promise<CastMediaResponse> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(ticket.metadata_url, {
        credentials: "omit",
      });
    } catch {
      throw new Error(
        "Could not reach the Cast media endpoint. Check that this Crate server is reachable over HTTPS.",
      );
    }
    if (response.status === 425) {
      if (attempt === maxAttempts - 1) {
        throw new Error(
          "Receiver-safe audio is still preparing. Try again shortly.",
        );
      }
      const retryAfter = Number(response.headers.get("Retry-After") || 1);
      const delayMs = Math.max(0, Math.min(5, retryAfter)) * 1000;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      continue;
    }
    if (!response.ok) {
      throw new Error("Could not prepare this track for Cast.");
    }
    return (await response.json()) as CastMediaResponse;
  }
  throw new Error("Could not prepare this track for Cast.");
}

export function buildNativePayload(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
  artworkUrl: string | undefined,
): NativeCastMediaPayload {
  const track = payload.track;
  return {
    streamUrl: media.stream_url || ticket.stream_url,
    metadataUrl: ticket.metadata_url,
    contentType: media.content_type || "audio/mpeg",
    title: media.title || track.title,
    artist: media.artist || track.artist,
    album: media.album || track.album || "",
    artworkUrl,
    duration: mediaDurationSeconds(media, track),
    currentTime: payload.currentTime,
  };
}

export function buildWebLoadRequest(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
  chromeCast: ChromeCastNamespace,
  artworkUrl: string | undefined,
): ChromeCastLoadRequest {
  const nativePayload = buildNativePayload(ticket, media, payload, artworkUrl);
  const mediaInfo = new chromeCast.media.MediaInfo(
    nativePayload.streamUrl,
    nativePayload.contentType,
  ) as ChromeCastMediaInfo;
  const metadata = new chromeCast.media.MusicTrackMediaMetadata();
  metadata.title = nativePayload.title;
  metadata.artist = nativePayload.artist;
  metadata.albumName = nativePayload.album;

  if (nativePayload.artworkUrl) {
    const image = new chromeCast.Image(
      nativePayload.artworkUrl,
    ) as ChromeCastImage;
    image.width = 512;
    image.height = 512;
    metadata.images = [image];
  }

  mediaInfo.metadata = metadata as ChromeCastMusicMetadata;
  mediaInfo.duration = nativePayload.duration;
  mediaInfo.customData = {
    metadataUrl: nativePayload.metadataUrl,
    delivery: media.delivery,
  };

  const request = new chromeCast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  request.currentTime = Math.max(0, Math.floor(payload.currentTime || 0));
  return request;
}

export function buildWebQueueLoad(
  session: CastPlaybackSessionResponse,
  chromeCast: ChromeCastNamespace,
): WebCastQueueLoad {
  const crateCast = {
    protocolVersion: 1 as const,
    sessionId: session.session_id,
  };
  const items = session.queue.items.map((item, index) => {
    const mediaInfo = new chromeCast.media.MediaInfo(
      item.stream_url,
      item.content_type || "audio/mpeg",
    );
    const metadata = new chromeCast.media.MusicTrackMediaMetadata();
    metadata.title = item.title;
    metadata.artist = item.artist;
    metadata.albumName = item.album || "";
    if (item.artwork_url) {
      const image = new chromeCast.Image(item.artwork_url);
      image.width = 512;
      image.height = 512;
      metadata.images = [image];
    }
    mediaInfo.metadata = metadata;
    mediaInfo.duration = item.duration;
    mediaInfo.customData = {
      crateCast: {
        ...crateCast,
        bootstrapUrl: session.bootstrap_url,
        itemId: item.item_id,
      },
    };
    const queueItem = new chromeCast.media.QueueItem(mediaInfo);
    queueItem.autoplay = true;
    if (index === session.queue.current_index) {
      queueItem.startTime = Math.max(0, session.queue.current_time);
    }
    return queueItem;
  });
  const repeatMode =
    session.queue.repeat_mode === "all"
      ? chromeCast.media.RepeatMode.ALL
      : session.queue.repeat_mode === "one"
        ? chromeCast.media.RepeatMode.SINGLE
        : chromeCast.media.RepeatMode.OFF;
  return {
    items,
    repeatMode,
    startIndex: session.queue.current_index,
    startTime: Math.max(0, session.queue.current_time),
    customData: { crateCast },
  };
}

export function buildNativeQueuePayload(
  session: CastPlaybackSessionResponse,
): NativeCastQueuePayload {
  return {
    protocolVersion: 1,
    sessionId: session.session_id,
    bootstrapUrl: session.bootstrap_url,
    currentIndex: session.queue.current_index,
    currentTime: Math.max(0, session.queue.current_time),
    repeatMode: session.queue.repeat_mode,
    items: session.queue.items.map((item) => ({
      stableId: item.item_id,
      streamUrl: item.stream_url,
      contentType: item.content_type || "audio/mpeg",
      title: item.title,
      artist: item.artist,
      album: item.album || "",
      ...(item.artwork_url ? { artworkUrl: item.artwork_url } : {}),
      ...(item.duration ? { duration: item.duration } : {}),
      customData: {
        crateCast: {
          protocolVersion: 1,
          sessionId: session.session_id,
          bootstrapUrl: session.bootstrap_url,
          itemId: item.item_id,
        },
      },
    })),
  };
}

export function buildCastTicketRequest(
  track: Track,
  targetDeviceId: string = DEFAULT_CAST_TARGET_ID,
): CastTicketRequest | null {
  const request: CastTicketRequest = {
    purpose: "google_cast",
    target_device_id: targetDeviceId,
    delivery: "auto",
    receiver_capabilities: DEFAULT_RECEIVER_CAPABILITIES,
  };

  if (typeof track.libraryTrackId === "number" && track.libraryTrackId > 0) {
    request.track_id = track.libraryTrackId;
    return request;
  }
  if (track.entityUid) {
    request.track_entity_uid = track.entityUid;
    return request;
  }
  if (track.path) {
    request.track_path = track.path;
    return request;
  }
  return null;
}
