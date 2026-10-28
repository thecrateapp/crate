import { validateOfflineArtworkImage } from "./offline-artwork-image";
import { apiFetch, apiUrl } from "./api";
import { isOfflineNativeRuntime } from "./offline-runtime";
import {
  getOfflineCacheName,
  ensureOfflineNativeAssetIndexLoaded,
} from "./offline-storage";
import {
  cacheNativeArtworkAsset,
  deleteNativeCachedTrackAsset,
  hasCachedNativeTrackAssets,
} from "./offline-native-assets";
import {
  offlineArtworkRefs,
  offlineArtworkRef,
  offlineArtworkRequestPath,
  type OfflineArtworkRef,
} from "./offline-artwork-identity";
import { notifyOfflineArtworkChanged } from "./offline-artwork-events";
import {
  runBoundedOfflineTasks,
  waitForOfflineTransferPermission,
} from "./offline-scheduler";
import type { OfflineItemRecord } from "./offline-model";
const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
function assertActive(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Offline download cancelled", "AbortError");
}
function nativeTrack(ref: OfflineArtworkRef) {
  return {
    entity_uid: ref.key,
    title: ref.key,
    artist: "",
    stream_url: ref.path,
    download_url: ref.path,
  };
}

/** Optional sidecars never invalidate audio readiness. A failed cover is retried on the next sync. */
export async function cacheOfflineArtwork(
  profileKey: string,
  refs: OfflineArtworkRef[],
  signal?: AbortSignal,
): Promise<void> {
  assertActive(signal);
  await runBoundedOfflineTasks(
    [...new Map(refs.map((ref) => [ref.key, ref])).values()],
    async (ref) => {
      assertActive(signal);
      try {
        if (isOfflineNativeRuntime) {
          if (
            (
              await hasCachedNativeTrackAssets(profileKey, [nativeTrack(ref)])
            ).has(ref.key)
          )
            return;
          await waitForOfflineTransferPermission(signal);
          assertActive(signal);
          await cacheNativeArtworkAsset(profileKey, ref, signal);
        } else {
          const cache = await caches.open(getOfflineCacheName(profileKey));
          const key = apiUrl(ref.path);
          if (await cache.match(key)) return;
          await waitForOfflineTransferPermission(signal);
          assertActive(signal);
          const response = await apiFetch(offlineArtworkRequestPath(ref), {
            method: "GET",
            signal,
          });
          if (
            !response.ok ||
            !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(
              response.headers.get("content-type") || "",
            )
          )
            return;
          const advertised = Number(
            response.headers.get("content-length") || 0,
          );
          if (advertised > MAX_ARTWORK_BYTES) return;
          const blob = await response.blob();
          assertActive(signal);
          if (!blob.size || blob.size > MAX_ARTWORK_BYTES) return;
          const preview = URL.createObjectURL(blob);
          try {
            await validateOfflineArtworkImage(preview, signal);
          } finally {
            URL.revokeObjectURL(preview);
          }
          assertActive(signal);
          await cache.put(
            key,
            new Response(blob, { headers: { "content-type": blob.type } }),
          );
          if (signal?.aborted) {
            await cache.delete(key);
            assertActive(signal);
          }
        }
        notifyOfflineArtworkChanged(profileKey, ref.key);
      } catch (error) {
        assertActive(signal);
        // Missing/failed artwork must not turn verified music into an unplayable download.
        if (error instanceof DOMException && error.name === "AbortError")
          throw error;
      }
    },
    { concurrency: 2, signal },
  );
  assertActive(signal);
}

/** Acquires a local image only; no API request, even when an old download lacks artwork. */
export async function readOfflineArtwork(
  profileKey: string,
  ref: OfflineArtworkRef,
): Promise<{ src: string; release: () => void } | null> {
  if (isOfflineNativeRuntime) {
    if (
      !(await hasCachedNativeTrackAssets(profileKey, [nativeTrack(ref)])).has(
        ref.key,
      )
    )
      return null;
    const entry = (await ensureOfflineNativeAssetIndexLoaded(profileKey))[
      ref.key
    ];
    return entry?.state !== "deleting" && entry?.playbackUrl
      ? { src: entry.playbackUrl, release: () => {} }
      : null;
  }
  if (typeof caches === "undefined") return null;
  const cached = await (
    await caches.open(getOfflineCacheName(profileKey))
  ).match(apiUrl(ref.path));
  if (!cached) return null;
  const src = URL.createObjectURL(await cached.blob());
  return { src, release: () => URL.revokeObjectURL(src) };
}

/** Shared album covers survive until no remaining offline item references them. */
export async function pruneOfflineArtwork(
  profileKey: string,
  items: OfflineItemRecord[],
): Promise<void> {
  const retained = new Set(offlineArtworkRefs(items).map((ref) => ref.key));
  if (isOfflineNativeRuntime) {
    const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    await Promise.all(
      Object.keys(assets)
        .filter((key) => key.startsWith("artwork:") && !retained.has(key))
        .map(async (key) => {
          await deleteNativeCachedTrackAsset(profileKey, key);
          notifyOfflineArtworkChanged(profileKey, key);
        }),
    );
  } else if (typeof caches !== "undefined") {
    const cache = await caches.open(getOfflineCacheName(profileKey));
    await Promise.all(
      (await cache.keys()).map(async (request) => {
        const ref = offlineArtworkRef(request.url);
        if (ref && !retained.has(ref.key) && (await cache.delete(request)))
          notifyOfflineArtworkChanged(profileKey, ref.key);
      }),
    );
  }
}

export async function discardOfflineArtwork(
  profileKey: string,
  ref: OfflineArtworkRef,
): Promise<void> {
  if (isOfflineNativeRuntime)
    await deleteNativeCachedTrackAsset(profileKey, ref.key);
  else if (typeof caches !== "undefined")
    await (
      await caches.open(getOfflineCacheName(profileKey))
    ).delete(apiUrl(ref.path));
  notifyOfflineArtworkChanged(profileKey, ref.key);
}
