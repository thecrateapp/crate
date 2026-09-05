import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

import {
  api,
  apiFetch,
  apiUrl,
  getApiAuthHeaders,
  getApiBase,
} from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import {
  isAndroidNative,
  isIosBrowser,
  isNative,
} from "@/lib/capacitor-runtime";
import { verifyNativeOfflineAssets } from "@/lib/offline-native";
import { encodeOfflineProfileIdentity } from "@/lib/offline-store";
import {
  cacheWebOfflineAsset,
  deleteWebOfflineAssets,
  hasWebOfflineAsset,
} from "@/lib/offline-web";
import type { PlaybackResolution } from "@/lib/track-playback";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  getOfflineTrackCacheUrls,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import type { OfflineTrackIdentityInput } from "@/lib/offline-track-identity";
import {
  ensureOfflineNativeAssetIndexLoaded,
  getActiveOfflineProfileKey,
  getOfflineCacheName,
  hydrateOfflineProfileState,
  loadOfflineNativeAssetIndex,
  saveOfflineNativeAssetIndex,
  setActiveOfflineProfileKey,
} from "./offline-storage";
import type {
  OfflineItemState,
  OfflineManifestTrack,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

export {
  getActiveOfflineProfileKey,
  getOfflineCacheName,
  getOfflineItemKey,
  hydrateOfflineProfileState,
  loadOfflineNativeAssetIndex,
  loadOfflineSnapshot,
  normalizeOfflineSnapshot,
  saveOfflineNativeAssetIndex,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
} from "./offline-storage";
export type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineItemState,
  OfflineManifest,
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

export {
  canonicalStreamPath,
  canonicalStreamUrl,
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
} from "@/lib/offline-track-identity";
export type { OfflineTrackIdentityInput } from "@/lib/offline-track-identity";

const OFFLINE_STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;
const NATIVE_OFFLINE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
const IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES = 450 * 1024 * 1024;
const ANDROID_OFFLINE_DELIVERY_POLICY = "balanced";

export function deriveOfflineProfileKey(
  userId: number,
  serverOrigin?: string,
): string {
  const origin = (
    serverOrigin ||
    getApiBase() ||
    window.location.origin ||
    "listen"
  ).replace(/\/+$/, "");
  return encodeOfflineProfileIdentity(`${origin}|${userId}`);
}

export function deriveOfflineProfileKeyFromStoredUser(
  serverOrigin?: string,
): string | null {
  if (typeof window === "undefined") return null;
  const rawUserId = getStoredAuthUserId(serverOrigin);
  const userId = rawUserId ? Number(rawUserId) : NaN;
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return deriveOfflineProfileKey(userId, serverOrigin);
}

export function isOfflineSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("localStorage" in window)) return false;
  if (isNative) return true;
  return (
    typeof navigator !== "undefined" &&
    "caches" in window &&
    "serviceWorker" in navigator
  );
}

export async function hasCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<boolean> {
  if (isNative) {
    const found = await hasCachedTrackAssets(profileKey, [
      typeof track === "object" && track
        ? (track as OfflineManifestTrack)
        : ({
            storage_id:
              typeof track === "string"
                ? normalizeIdentityValue(storageId) ||
                  normalizeIdentityValue(track)
                : normalizeIdentityValue(storageId),
            title: "",
            artist: "",
            stream_url: "",
            download_url: "",
          } satisfies OfflineManifestTrack),
    ]);
    const assetKey = getOfflineTrackAssetKey(track, storageId);
    return Boolean(assetKey && found.has(assetKey));
  }
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return false;
  const cache = await caches.open(getOfflineCacheName(profileKey));
  return hasWebOfflineAsset(cache, getOfflineTrackCacheUrls(track, storageId));
}

export async function hasCachedTrackAssets(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  if (!tracks.length) return new Set();
  if (!isNative) {
    const cachedKeys = await Promise.all(
      tracks.map(async (track) => {
        const assetKey = getOfflineTrackAssetKey(track);
        return assetKey && (await hasCachedTrackAsset(profileKey, track))
          ? assetKey
          : null;
      }),
    );
    return new Set(
      cachedKeys.filter((assetKey): assetKey is string => Boolean(assetKey)),
    );
  }

  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const expectations: Array<{
    assetKey: string;
    aliases: string[];
    path: string;
    expectedBytes: number | null;
  }> = [];
  for (const track of tracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    const aliases = getOfflineTrackAssetAliases(track);
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (!entry?.path) continue;
    expectations.push({
      assetKey,
      aliases,
      path: entry.path,
      expectedBytes: entry.byteLength ?? track.byte_length ?? null,
    });
  }

  const results = await verifyNativeOfflineAssets(
    expectations.map(({ path, expectedBytes }) => ({ path, expectedBytes })),
  );
  const found = new Set<string>();
  const nextAssets = { ...assets };
  let changed = false;
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const result = results[index];
    if (!expectation) continue;
    if (result?.exists && result.valid) {
      found.add(expectation.assetKey);
      continue;
    }
    for (const alias of expectation.aliases) {
      if (nextAssets[alias]) {
        delete nextAssets[alias];
        changed = true;
      }
    }
  }
  if (changed) saveOfflineNativeAssetIndex(profileKey, nextAssets);
  return found;
}

function normalizeAudioExtension(value?: string | null): string | null {
  const candidate = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!candidate) return null;
  if (candidate === "aac") return "m4a";
  return candidate;
}

function inferOfflineFileExtension(
  track: OfflineManifestTrack,
  formatOverride?: string | null,
): string {
  return (
    normalizeAudioExtension(formatOverride) ||
    normalizeAudioExtension(track.format) ||
    "bin"
  );
}

function safeOfflineFileStem(assetKey: string): string {
  const trimmed = assetKey.trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function expectedTrackBytes(track: OfflineManifestTrack): number {
  return Math.max(0, Number(track.byte_length || 0));
}

async function assertNativeTrackIntegrity(
  path: string,
  expectedBytes?: number | null,
): Promise<{ uri: string; size: number }> {
  const stat = await Filesystem.stat({
    path,
    directory: Directory.Data,
  });
  const actualSize = Number(stat.size || 0);
  const expectedSize = Math.max(0, Number(expectedBytes ?? 0));
  if (expectedSize > 0 && actualSize > 0 && actualSize !== expectedSize) {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    }).catch(() => {
      // best-effort cleanup on integrity failure
    });
    throw new Error("Offline copy failed integrity check");
  }
  return { uri: stat.uri, size: actualSize };
}

async function estimateMissingOfflineBytes(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<number> {
  const missingBytes = await Promise.all(
    tracks.map(async (track) => {
      if (!getOfflineTrackAssetKey(track)) return 0;
      const cached = await hasCachedTrackAsset(profileKey, track);
      return cached ? 0 : expectedTrackBytes(track);
    }),
  );
  return missingBytes.reduce((total, bytes) => total + bytes, 0);
}

async function estimateNativeOfflineBytes(profileKey: string): Promise<number> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  return Object.values(assets).reduce(
    (total, asset) => total + Math.max(0, Number(asset.byteLength || 0)),
    0,
  );
}

export async function ensureOfflineStorageBudget(
  profileKey: string,
  tracks: OfflineManifestTrack[],
  options: { assumeMissing?: boolean } = {},
): Promise<void> {
  const pendingBytes = options.assumeMissing
    ? tracks.reduce(
        (total, track) =>
          total +
          (getOfflineTrackAssetKey(track) ? expectedTrackBytes(track) : 0),
        0,
      )
    : await estimateMissingOfflineBytes(profileKey, tracks);
  if (pendingBytes <= 0) return;
  if (isNative) {
    const currentBytes = await estimateNativeOfflineBytes(profileKey);
    if (
      currentBytes + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES >
      NATIVE_OFFLINE_SOFT_LIMIT_BYTES
    ) {
      throw new Error("Offline copies are above the native storage budget");
    }
    return;
  }
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  if (
    isIosBrowser &&
    usage + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES >
      IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES
  ) {
    throw new Error("Offline copies are above the iOS browser storage budget");
  }
  if (!quota || quota <= 0) return;
  const available = Math.max(quota - usage, 0);
  if (pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > available) {
    throw new Error("Not enough browser storage available for offline copy");
  }
}

interface NativeOfflineDownloadTarget {
  streamUrl: string;
  extension: string;
  expectedBytes: number | null;
  effectivePolicy: string;
}

function nativePlaybackPathForTrack(
  track: OfflineManifestTrack,
): string | null {
  if (track.entity_uid) {
    return `/api/tracks/by-entity/${encodeURIComponent(
      track.entity_uid,
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  if (track.track_id) {
    return `/api/tracks/${encodeURIComponent(
      String(track.track_id),
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  return null;
}

function sourceNeedsMobileVariant(
  track: OfflineManifestTrack,
  resolution?: PlaybackResolution | null,
): boolean {
  const sourceFormat = normalizeAudioExtension(
    resolution?.source?.format || track.format,
  );
  const sourceBitrate = Number(
    resolution?.source?.bitrate || track.bitrate || 0,
  );
  const sourceSampleRate = Number(
    resolution?.source?.sample_rate || track.sample_rate || 0,
  );
  if (resolution?.source?.lossless) return true;
  if (!sourceFormat) return false;
  if (["flac", "wav", "alac", "aiff", "aif"].includes(sourceFormat))
    return true;
  if (["m4a", "mp3", "opus", "ogg"].includes(sourceFormat)) {
    return sourceBitrate > 256 || sourceSampleRate > 48_000;
  }
  return false;
}

async function resolveNativeOfflineDownloadTarget(
  track: OfflineManifestTrack,
): Promise<NativeOfflineDownloadTarget> {
  const fallback = {
    streamUrl: track.stream_url,
    extension: inferOfflineFileExtension(track),
    expectedBytes: expectedTrackBytes(track) || null,
    effectivePolicy: "original",
  };
  if (!isAndroidNative) return fallback;

  const playbackPath = nativePlaybackPathForTrack(track);
  if (!playbackPath) return fallback;

  let resolution: PlaybackResolution;
  try {
    resolution = await api<PlaybackResolution>(playbackPath);
  } catch {
    if (sourceNeedsMobileVariant(track)) {
      throw new Error("Could not prepare the Android offline copy");
    }
    return fallback;
  }

  if (resolution.preparing && sourceNeedsMobileVariant(track, resolution)) {
    throw new Error("Preparing the Android offline copy. Try again shortly.");
  }

  if (resolution.effective_policy === "original") {
    return fallback;
  }

  const deliveryFormat =
    resolution.delivery?.format || resolution.delivery?.codec;
  return {
    streamUrl: resolution.stream_url || track.stream_url,
    extension: inferOfflineFileExtension(track, deliveryFormat),
    expectedBytes: Number(resolution.delivery?.bytes || 0) || null,
    effectivePolicy: resolution.effective_policy,
  };
}

export async function cacheTrackAsset(
  profileKey: string,
  track: OfflineManifestTrack,
): Promise<void> {
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  if (isNative) {
    const existingAssets =
      await ensureOfflineNativeAssetIndexLoaded(profileKey);
    const existing = getOfflineTrackAssetAliases(track)
      .map((alias) => existingAssets[alias])
      .find(Boolean);
    if (existing) return;

    const downloadTarget = await resolveNativeOfflineDownloadTarget(track);
    const dirPath = `offline-media/${profileKey}`;
    const filePath = `${dirPath}/${safeOfflineFileStem(assetKey)}.${
      downloadTarget.extension
    }`;

    await Filesystem.mkdir({
      path: dirPath,
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {
      // mkdir may fail if the directory already exists
    });

    await Filesystem.downloadFile({
      url: apiUrl(downloadTarget.streamUrl),
      path: filePath,
      directory: Directory.Data,
      recursive: true,
      headers: getApiAuthHeaders(),
    });

    const { uri, size } = await assertNativeTrackIntegrity(
      filePath,
      downloadTarget.expectedBytes,
    );

    const nextAssets = loadOfflineNativeAssetIndex(profileKey);
    nextAssets[assetKey] = {
      assetKey,
      entityUid: track.entity_uid ?? null,
      storageId: track.storage_id,
      path: filePath,
      uri,
      playbackUrl: Capacitor.convertFileSrc(uri),
      byteLength: downloadTarget.expectedBytes || size,
      updatedAt: track.updated_at ?? null,
    };
    saveOfflineNativeAssetIndex(profileKey, nextAssets);
    return;
  }

  const cache = await caches.open(getOfflineCacheName(profileKey));
  const cacheKey = apiUrl(track.stream_url);
  await cacheWebOfflineAsset(
    cache,
    cacheKey,
    () => apiFetch(track.stream_url, { method: "GET" }),
    expectedTrackBytes(track),
  );
}

export async function deleteCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<void> {
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  if (isNative) {
    const assets = {
      ...(await ensureOfflineNativeAssetIndexLoaded(profileKey)),
    };
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (entry?.path) {
      await Filesystem.deleteFile({
        path: entry.path,
        directory: Directory.Data,
      }).catch(() => {
        // ignore missing files; we still want to clear metadata
      });
    }
    for (const alias of aliases) {
      delete assets[alias];
    }
    saveOfflineNativeAssetIndex(profileKey, assets);
    return;
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  await deleteWebOfflineAssets(
    cache,
    getOfflineTrackCacheUrls(track, storageId),
  );
}

export async function clearOfflineAssets(profileKey: string): Promise<void> {
  if (isNative) {
    const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    await Promise.all(
      Object.values(assets).map((asset) =>
        Filesystem.deleteFile({
          path: asset.path,
          directory: Directory.Data,
        }).catch(() => {
          // ignore missing files during cleanup
        }),
      ),
    );
    saveOfflineNativeAssetIndex(profileKey, {});
    return;
  }
  await caches.delete(getOfflineCacheName(profileKey));
}

export function buildAssetUsage(
  snapshot: OfflineSnapshot,
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const item of Object.values(snapshot.items)) {
    for (const track of item.tracks) {
      const assetKey = getOfflineTrackAssetKey(track);
      if (!assetKey) continue;
      usage.set(assetKey, (usage.get(assetKey) || 0) + 1);
    }
  }
  return usage;
}

export function summarizeOfflineSnapshot(
  snapshot: OfflineSnapshot,
): OfflineSummary {
  const items = Object.values(snapshot.items);
  return items.reduce<OfflineSummary>(
    (summary, item) => {
      summary.itemCount += 1;
      summary.trackCount += item.trackCount || item.tracks.length;
      summary.readyTrackCount += item.readyTrackCount || 0;
      summary.totalBytes += Number(item.totalBytes || 0);
      if (item.state === "ready") summary.readyItemCount += 1;
      if (item.state === "error") summary.errorItemCount += 1;
      return summary;
    },
    {
      itemCount: 0,
      readyItemCount: 0,
      errorItemCount: 0,
      trackCount: 0,
      readyTrackCount: 0,
      totalBytes: 0,
    },
  );
}

export function isOfflineBusy(state: OfflineItemState): boolean {
  return state === "queued" || state === "downloading" || state === "syncing";
}

export function getOfflineStateLabel(state: OfflineItemState): string | null {
  switch (state) {
    case "queued":
      return "Queued for offline";
    case "downloading":
      return "Downloading for offline";
    case "syncing":
      return "Syncing offline copy";
    case "ready":
      return "Available offline";
    case "error":
      return "Offline copy failed";
    default:
      return null;
  }
}

export function getOfflineActionLabel(state: OfflineItemState): string {
  switch (state) {
    case "ready":
      return "Remove offline copy";
    case "error":
      return "Retry offline copy";
    case "queued":
    case "downloading":
      return "Downloading...";
    case "syncing":
      return "Syncing...";
    default:
      return "Make available offline";
  }
}

export function getOfflineNativePlaybackUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
  options: { target?: "webview" | "android-native" } = {},
): string | null {
  if (!isNative) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const assets = loadOfflineNativeAssetIndex(profileKey);
  const entry = getOfflineTrackAssetAliases(track, storageId)
    .map((alias) => assets[alias])
    .find(Boolean);
  if (!entry) return null;
  return options.target === "android-native"
    ? entry.uri || null
    : entry.playbackUrl || null;
}

export async function syncOfflineProfileToServiceWorker(
  profileKey: string | null,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;

  const payload = { type: "crate:set-offline-profile", profileKey };
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage(payload);
    navigator.serviceWorker.controller?.postMessage(payload);
  } catch {
    // ignore; service worker may not be ready yet
  }
}

export async function primeOfflineRuntimeProfile(
  serverOrigin?: string,
): Promise<void> {
  const profileKey = deriveOfflineProfileKeyFromStoredUser(serverOrigin);
  setActiveOfflineProfileKey(profileKey);
  if (isNative && profileKey) {
    await hydrateOfflineProfileState(profileKey);
  }
  await syncOfflineProfileToServiceWorker(profileKey);
}
