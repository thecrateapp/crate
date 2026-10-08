import { getApiBase } from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import { encodeOfflineProfileIdentity } from "@/lib/offline-store";
import { isOfflineNativeRuntime } from "@/lib/offline-runtime";
import { isWebRuntime } from "@/lib/platform";
import { getOfflineTrackAssetKey } from "@/lib/offline-track-identity";
import { hasCachedTrackAssets } from "@/lib/offline-assets";
import {
  hydrateOfflineProfileState,
  setActiveOfflineProfileKey,
} from "./offline-storage";
import type {
  OfflineItemState,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

export {
  cacheTrackAsset,
  clearOfflineAssets,
  deleteCachedTrackAsset,
  ensureOfflineStorageBudget,
  getOfflineAssetsNeedingRefresh,
  hasCachedTrackAsset,
  hasCachedTrackAssets,
  getOfflineNativePlaybackUrl,
} from "@/lib/offline-assets";
export {
  getActiveOfflineProfileKey,
  getOfflineCacheName,
  getOfflineItemKey,
  hydrateOfflineProfileState,
  isOfflineMediaCacheName,
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
export {
  getOfflineActionLabel,
  getOfflineStateLabel,
  isOfflineBusy,
} from "@crate/ui/lib/offline";

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
  // Capacitor and Tauri both provide a persistent native filesystem adapter;
  // browser runtimes need both Cache Storage and a service worker.
  if (isOfflineNativeRuntime) return true;
  return (
    typeof navigator !== "undefined" &&
    "caches" in window &&
    "serviceWorker" in navigator
  );
}

export async function hasOfflinePlaybackContent(
  profileKey: string,
): Promise<boolean> {
  const snapshot = await hydrateOfflineProfileState(profileKey);
  const candidates = Object.values(snapshot.items).flatMap((item) => {
    const readyKeys = new Set(item.readyAssetKeys ?? []);
    return item.tracks.filter((track) => {
      const assetKey = getOfflineTrackAssetKey(track);
      if (!assetKey) return false;
      if (item.readyAssetKeys) return readyKeys.has(assetKey);
      return item.state === "ready";
    });
  });

  for (let offset = 0; offset < candidates.length; offset += 16) {
    const batch = candidates.slice(offset, offset + 16);
    if ((await hasCachedTrackAssets(profileKey, batch)).size > 0) return true;
  }
  return false;
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

export function getOfflineActionLabelKey(state: OfflineItemState): string {
  switch (state) {
    case "ready":
      return "actions.offline.removeCopy";
    case "error":
      return "actions.offline.retryCopy";
    case "queued":
    case "downloading":
      return "actions.offline.downloading";
    case "syncing":
      return "actions.offline.syncing";
    default:
      return "actions.offline.makeAvailable";
  }
}

export async function syncOfflineProfileToServiceWorker(
  profileKey: string | null,
): Promise<void> {
  if (
    !isWebRuntime ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  )
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
  if (isOfflineNativeRuntime && profileKey) {
    await hydrateOfflineProfileState(profileKey);
  }
  await syncOfflineProfileToServiceWorker(profileKey);
}
