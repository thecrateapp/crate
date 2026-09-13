// Mirrors the transport variants of PlaybackCommand in
// app/listen-desktop/src-tauri/src/lib.rs — update both together. A Rust
// test (transport_commands_match_the_frontend_contract) pins the exact
// wire strings on that side.
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
let desktopArtworkPreparationSequence = 0;
const preparedDesktopArtwork = new Map<string, string>();
const pendingDesktopArtwork = new Map<
  string,
  Promise<DesktopArtworkPreparationResult>
>();
const pendingDesktopArtworkSequences = new Map<string, number>();
const evictedDesktopArtworkSequences = new Map<string, number>();

interface DesktopArtworkCacheResult {
  url: string;
  evictedUrls: string[];
}

interface DesktopArtworkPreparationResult {
  url: string | null;
  invalidated: boolean;
}

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
    payload.artwork && shouldMaterializeDesktopArtwork(payload.artwork)
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
    artwork: shouldMaterializeDesktopArtwork(payload.artwork)
      ? null
      : payload.artwork,
  });

  if (!payload.artwork || !shouldMaterializeDesktopArtwork(payload.artwork)) {
    return;
  }

  const artworkSource = payload.artwork;
  void prepareDesktopArtwork(artworkSource)
    .then(async (result) => {
      if (sequence !== desktopMediaSessionSequence) return;
      const currentResult = result.invalidated
        ? await prepareDesktopArtwork(artworkSource)
        : result;
      if (sequence !== desktopMediaSessionSequence) return;
      invokeDesktopMediaSession({
        ...payload,
        artwork: currentResult.url,
      });
    })
    .catch(() => undefined);
}

function invokeDesktopMediaSession(payload: DesktopMediaSessionPayload): void {
  void window
    .__crateTauriInvoke?.("update_desktop_media_session", { payload })
    .catch(() => undefined);
}

function shouldMaterializeDesktopArtwork(
  artwork: string | null | undefined,
): artwork is string {
  if (!artwork) return false;
  if (
    artwork.startsWith("data:") ||
    artwork.startsWith("blob:") ||
    artwork.startsWith("capacitor:")
  ) {
    return true;
  }
  return (
    typeof navigator !== "undefined" &&
    /\bLinux\b/i.test(navigator.userAgent) &&
    (artwork.startsWith("http://") || artwork.startsWith("https://"))
  );
}

function prepareDesktopArtwork(
  artwork: string,
): Promise<DesktopArtworkPreparationResult> {
  const cached = preparedDesktopArtwork.get(artwork);
  if (cached !== undefined) {
    return Promise.resolve({ url: cached, invalidated: false });
  }

  const pending = pendingDesktopArtwork.get(artwork);
  if (pending) return pending;

  const preparationSequence = ++desktopArtworkPreparationSequence;
  const promise = fetchAndCacheDesktopArtwork(artwork, preparationSequence)
    .then((fileUrl) => {
      pendingDesktopArtwork.delete(artwork);
      pendingDesktopArtworkSequences.delete(artwork);
      const invalidated = Boolean(
        fileUrl && wasDesktopArtworkEvictedAfter(fileUrl, preparationSequence),
      );
      const usableFileUrl = fileUrl && !invalidated ? fileUrl : null;
      if (usableFileUrl) rememberPreparedArtwork(artwork, usableFileUrl);
      pruneSettledDesktopArtworkEvictions();
      return { url: usableFileUrl, invalidated };
    })
    .catch(() => {
      pendingDesktopArtwork.delete(artwork);
      pendingDesktopArtworkSequences.delete(artwork);
      pruneSettledDesktopArtworkEvictions();
      return { url: null, invalidated: false };
    });

  pendingDesktopArtworkSequences.set(artwork, preparationSequence);
  pendingDesktopArtwork.set(artwork, promise);
  return promise;
}

async function fetchAndCacheDesktopArtwork(
  artwork: string,
  preparationSequence: number,
): Promise<string | null> {
  const response = await fetch(artwork);
  if (!response.ok) return null;

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_DESKTOP_ARTWORK_BYTES) return null;

  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_DESKTOP_ARTWORK_BYTES) return null;

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const result = await window.__crateTauriInvoke?.<
    DesktopArtworkCacheResult | string | null
  >("cache_desktop_media_artwork", {
    cacheKey: artwork,
    bytes,
    mimeType: blob.type || response.headers.get("content-type") || null,
  });
  if (!result) return null;
  if (typeof result === "string") return result;
  if (typeof result.url !== "string") return null;
  forgetEvictedPreparedArtwork(result.evictedUrls, preparationSequence);
  return result.url;
}

function forgetEvictedPreparedArtwork(
  evictedUrls: string[],
  preparationSequence: number,
): void {
  if (!Array.isArray(evictedUrls) || evictedUrls.length === 0) return;
  const evicted = new Set(
    evictedUrls.filter(
      (fileUrl): fileUrl is string => typeof fileUrl === "string",
    ),
  );
  for (const fileUrl of evicted) {
    evictedDesktopArtworkSequences.set(fileUrl, preparationSequence);
  }
  for (const [artwork, fileUrl] of preparedDesktopArtwork) {
    if (evicted.has(fileUrl)) preparedDesktopArtwork.delete(artwork);
  }
}

function wasDesktopArtworkEvictedAfter(
  fileUrl: string,
  preparationSequence: number,
): boolean {
  return (
    (evictedDesktopArtworkSequences.get(fileUrl) ?? 0) > preparationSequence
  );
}

function pruneSettledDesktopArtworkEvictions(): void {
  if (pendingDesktopArtworkSequences.size === 0) {
    evictedDesktopArtworkSequences.clear();
    return;
  }
  const oldestPendingSequence = Math.min(
    ...pendingDesktopArtworkSequences.values(),
  );
  for (const [fileUrl, evictionSequence] of evictedDesktopArtworkSequences) {
    if (evictionSequence <= oldestPendingSequence) {
      evictedDesktopArtworkSequences.delete(fileUrl);
    }
  }
}

function rememberPreparedArtwork(artwork: string, fileUrl: string): void {
  preparedDesktopArtwork.set(artwork, fileUrl);

  while (preparedDesktopArtwork.size > MAX_CACHED_DESKTOP_ARTWORK) {
    const oldestKey = preparedDesktopArtwork.keys().next().value;
    if (!oldestKey) break;
    preparedDesktopArtwork.delete(oldestKey);
  }
}
