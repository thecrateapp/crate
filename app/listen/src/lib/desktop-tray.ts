export type DesktopTrayCommand =
  | "play"
  | "pause"
  | "play_pause"
  | "previous"
  | "next";

export const DESKTOP_TRAY_COMMAND_EVENT = "crate:desktop-tray-command";

export interface DesktopNowPlayingPayload {
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
}

export interface DesktopMediaSessionPayload extends DesktopNowPlayingPayload {
  album: string | null;
  artwork: string | null;
  position: number;
  duration: number;
}

const MAX_DESKTOP_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_DESKTOP_ARTWORK = 24;

let desktopMediaSessionSequence = 0;
const preparedDesktopArtwork = new Map<string, string>();
const pendingDesktopArtwork = new Map<string, Promise<string | null>>();

export function dispatchDesktopTrayCommand(command: DesktopTrayCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DesktopTrayCommand>(DESKTOP_TRAY_COMMAND_EVENT, {
      detail: command,
    }),
  );
}

export function syncDesktopNowPlaying(payload: DesktopNowPlayingPayload): void {
  if (typeof window === "undefined" || !window.__crateTauriInvoke) return;
  void window
    .__crateTauriInvoke("update_now_playing", { payload })
    .catch(() => undefined);
}

export function syncDesktopMediaSession(
  payload: DesktopMediaSessionPayload,
): void {
  if (typeof window === "undefined" || !window.__crateTauriInvoke) return;

  const sequence = ++desktopMediaSessionSequence;
  const cachedArtwork =
    payload.artwork && shouldCacheArtworkForLinuxMpris(payload.artwork)
      ? preparedDesktopArtwork.get(payload.artwork)
      : undefined;

  if (cachedArtwork !== undefined) {
    invokeDesktopMediaSession({
      ...payload,
      artwork: cachedArtwork,
    });
    return;
  }

  invokeDesktopMediaSession({
    ...payload,
    artwork: shouldCacheArtworkForLinuxMpris(payload.artwork)
      ? null
      : payload.artwork,
  });

  if (!payload.artwork || !shouldCacheArtworkForLinuxMpris(payload.artwork)) {
    return;
  }

  void prepareDesktopArtwork(payload.artwork)
    .then((artwork) => {
      if (sequence !== desktopMediaSessionSequence) return;
      invokeDesktopMediaSession({
        ...payload,
        artwork,
      });
    })
    .catch(() => undefined);
}

function invokeDesktopMediaSession(payload: DesktopMediaSessionPayload): void {
  void window
    .__crateTauriInvoke?.("update_desktop_media_session", { payload })
    .catch(() => undefined);
}

function shouldCacheArtworkForLinuxMpris(
  artwork: string | null | undefined,
): artwork is string {
  if (!artwork || typeof navigator === "undefined") return false;
  if (!/\bLinux\b/i.test(navigator.userAgent)) return false;
  return (
    artwork.startsWith("http://") ||
    artwork.startsWith("https://") ||
    artwork.startsWith("data:") ||
    artwork.startsWith("blob:")
  );
}

function prepareDesktopArtwork(artwork: string): Promise<string | null> {
  const cached = preparedDesktopArtwork.get(artwork);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingDesktopArtwork.get(artwork);
  if (pending) return pending;

  const promise = fetchAndCacheDesktopArtwork(artwork)
    .then((fileUrl) => {
      pendingDesktopArtwork.delete(artwork);
      if (fileUrl) rememberPreparedArtwork(artwork, fileUrl);
      return fileUrl;
    })
    .catch(() => {
      pendingDesktopArtwork.delete(artwork);
      return null;
    });

  pendingDesktopArtwork.set(artwork, promise);
  return promise;
}

async function fetchAndCacheDesktopArtwork(
  artwork: string,
): Promise<string | null> {
  const response = await fetch(artwork);
  if (!response.ok) return null;

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_DESKTOP_ARTWORK_BYTES) return null;

  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_DESKTOP_ARTWORK_BYTES) return null;

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const result = await window.__crateTauriInvoke?.<string | null>(
    "cache_desktop_media_artwork",
    {
      cacheKey: artwork,
      bytes,
      mimeType: blob.type || response.headers.get("content-type") || null,
    },
  );
  return result || null;
}

function rememberPreparedArtwork(artwork: string, fileUrl: string): void {
  preparedDesktopArtwork.set(artwork, fileUrl);

  while (preparedDesktopArtwork.size > MAX_CACHED_DESKTOP_ARTWORK) {
    const oldestKey = preparedDesktopArtwork.keys().next().value;
    if (!oldestKey) break;
    preparedDesktopArtwork.delete(oldestKey);
  }
}
