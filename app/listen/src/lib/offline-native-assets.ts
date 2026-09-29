import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

import { api, apiUrl, getApiAuthHeaders } from "@/lib/api";
import { isAndroidNative, isIosNative } from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";
import { isOfflineNativeRuntime } from "@/lib/offline-runtime";
import { isTauriRuntime } from "@/lib/platform";
import {
  excludeNativeOfflineAssetFromBackup,
  verifyNativeOfflineAssets,
} from "@/lib/offline-native";
import type { PlaybackResolution } from "@/lib/track-playback";
import { downloadTauriOfflineAsset } from "@/lib/offline-tauri-transfer";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import type {
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
} from "./offline-model";
import {
  ensureOfflineNativeAssetIndexLoaded,
  getActiveOfflineProfileKey,
  loadOfflineNativeAssetIndex,
  updateOfflineNativeAssetIndex,
} from "./offline-storage";
import type { OfflineTrackIdentityInput } from "./offline-track-identity";

const ANDROID_OFFLINE_DELIVERY_POLICY = "balanced";
const FILESYSTEM_NOT_FOUND_CODE = "OS-PLUG-FILE-0008";
let offlineAssetVersion = 0;

function isMissingNativeFileError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === FILESYSTEM_NOT_FOUND_CODE
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:does not exist|file not found|no such file or directory)/i.test(
    message,
  );
}

function throwIfOfflineTransferAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Offline transfer cancelled");
  error.name = "AbortError";
  throw error;
}

export async function hasCachedNativeTrackAssets(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  if (!tracks.length) return new Set();

  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const expectations: Array<{
    assetKey: string;
    aliases: string[];
    entry: OfflineNativeAssetRecord;
    path: string;
    expectedBytes: number | null;
  }> = [];
  for (const track of tracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    const aliases = getOfflineTrackAssetAliases(track);
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (!entry?.path || entry.state === "deleting") continue;
    expectations.push({
      assetKey,
      aliases,
      entry,
      path: entry.path,
      expectedBytes: entry.deliveryByteLength ?? entry.byteLength ?? null,
    });
  }

  const results = await verifyNativeOfflineAssets(
    expectations.map(({ path, expectedBytes }) => ({ path, expectedBytes })),
  );
  const found = new Set<string>();
  const staleEntries = new Map<string, OfflineNativeAssetRecord>();
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const result = results[index];
    if (!expectation) continue;
    if (result?.exists && result.valid) {
      found.add(expectation.assetKey);
      continue;
    }
    for (const alias of expectation.aliases) {
      const entry = assets[alias];
      if (entry?.path === expectation.path) staleEntries.set(alias, entry);
    }
  }
  if (staleEntries.size) {
    // The stat check above can take a while across many tracks — re-read
    // the index from inside the atomic update instead of reusing the
    // snapshot captured before it, so a concurrent cache/delete that
    // landed in the meantime isn't clobbered by this stale-entry prune.
    await updateOfflineNativeAssetIndex(profileKey, (current) => {
      const next = { ...current };
      let changed = false;
      for (const [alias, staleEntry] of staleEntries) {
        const currentEntry = next[alias];
        if (
          currentEntry !== staleEntry ||
          currentEntry.state !== staleEntry.state
        )
          continue;
        delete next[alias];
        changed = true;
      }
      return changed ? next : current;
    });
  }
  return found;
}

export async function estimateNativeOfflineBytes(
  profileKey: string,
): Promise<number> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const byPath = new Map<string, OfflineNativeAssetRecord>();
  for (const asset of Object.values(assets)) {
    if (asset.state === "deleting") continue;
    byPath.set(asset.path, asset);
  }
  return [...byPath.values()].reduce(
    (total, asset) =>
      total +
      Math.max(0, Number(asset.deliveryByteLength ?? asset.byteLength ?? 0)),
    0,
  );
}

function offlineSourceFingerprint(track: OfflineManifestTrack): string {
  return JSON.stringify({
    updatedAt: track.updated_at ?? null,
    byteLength: Number(track.byte_length || 0) || null,
    format: normalizeAudioExtension(track.format),
    bitrate: Number(track.bitrate || 0) || null,
    sampleRate: Number(track.sample_rate || 0) || null,
  });
}

function requestedDeliveryPolicy(): string {
  return isAndroidNative ? ANDROID_OFFLINE_DELIVERY_POLICY : "original";
}

function nextOfflineAssetVersion(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : "local";
  offlineAssetVersion += 1;
  return `${Date.now().toString(36)}-${offlineAssetVersion}-${random}`;
}

async function deleteNativeAssetQuietly(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch (error) {
    if (!isMissingNativeFileError(error)) {
      recordDevLog(
        "offline",
        "failed to clean up a replaced native asset",
        { path, error: String(error) },
        "warn",
      );
    }
  }
}

export async function getNativeOfflineAssetsNeedingRefresh(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const stale = new Set<string>();
  for (const track of tracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    const entry = getOfflineTrackAssetAliases(track)
      .map((alias) => assets[alias])
      .find((candidate) => candidate?.state !== "deleting");
    if (
      entry?.path &&
      (entry.originFingerprint !== offlineSourceFingerprint(track) ||
        (entry.requestedDeliveryPolicy ?? entry.deliveryPolicy) !==
          requestedDeliveryPolicy())
    ) {
      stale.add(assetKey);
    }
  }
  return stale;
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

export async function assertNativeTrackIntegrity(
  path: string,
  expectedBytes?: number | null,
): Promise<{ uri: string; size: number }> {
  const stat = await Filesystem.stat({
    path,
    directory: Directory.Data,
  });
  const actualSize = Number(stat.size || 0);
  const expectedSize = Math.max(0, Number(expectedBytes ?? 0));
  // A 0-byte file is never a valid asset, even when we have no expected
  // size to compare against — it means a download that started and
  // produced an empty file, not one that legitimately has no content.
  const isValid =
    actualSize > 0 && (expectedSize === 0 || actualSize === expectedSize);
  if (!isValid) {
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

  if (resolution.effective_policy === "original") return fallback;

  const deliveryFormat =
    resolution.delivery?.format || resolution.delivery?.codec;
  return {
    streamUrl: resolution.stream_url || track.stream_url,
    extension: inferOfflineFileExtension(track, deliveryFormat),
    expectedBytes: Number(resolution.delivery?.bytes || 0) || null,
    effectivePolicy: resolution.effective_policy,
  };
}

export async function cacheNativeTrackAsset(
  profileKey: string,
  track: OfflineManifestTrack,
  signal?: AbortSignal,
): Promise<void> {
  if (!isOfflineNativeRuntime) return;
  throwIfOfflineTransferAborted(signal);
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  const existingAssets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  throwIfOfflineTransferAborted(signal);
  const aliases = getOfflineTrackAssetAliases(track);
  const existing = aliases.map((alias) => existingAssets[alias]).find(Boolean);
  if (existing?.state === "deleting") {
    await deleteNativeCachedTrackAsset(profileKey, track);
  } else if (
    existing?.path &&
    existing.originFingerprint === offlineSourceFingerprint(track) &&
    existing.deliveryPolicy === requestedDeliveryPolicy()
  ) {
    return;
  }

  const downloadTarget = await resolveNativeOfflineDownloadTarget(track);
  throwIfOfflineTransferAborted(signal);
  const dirPath = `offline-media/${profileKey}`;
  const version = nextOfflineAssetVersion();
  const fileStem = safeOfflineFileStem(assetKey);
  const stagePath = `${dirPath}/.${fileStem}.${version}.part.${downloadTarget.extension}`;
  const filePath = `${dirPath}/${fileStem}.${version}.${downloadTarget.extension}`;

  let published = false;
  let committed = false;
  let indexUpdateStarted = false;
  let previousEntries: Record<string, OfflineNativeAssetRecord | undefined> =
    {};
  try {
    await Filesystem.mkdir({
      path: dirPath,
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {
      // mkdir may fail if the directory already exists
    });
    throwIfOfflineTransferAborted(signal);

    if (isTauriRuntime) {
      await downloadTauriOfflineAsset({
        profileKey,
        assetKey,
        url: apiUrl(downloadTarget.streamUrl),
        path: stagePath,
        headers: getApiAuthHeaders(),
        signal,
      });
    } else {
      await Filesystem.downloadFile({
        url: apiUrl(downloadTarget.streamUrl),
        path: stagePath,
        directory: Directory.Data,
        recursive: true,
        headers: getApiAuthHeaders(),
      });
    }
    throwIfOfflineTransferAborted(signal);

    const staged = await assertNativeTrackIntegrity(
      stagePath,
      downloadTarget.expectedBytes,
    );
    throwIfOfflineTransferAborted(signal);
    if (isIosNative) await excludeNativeOfflineAssetFromBackup(stagePath);
    throwIfOfflineTransferAborted(signal);

    await Filesystem.rename({
      from: stagePath,
      to: filePath,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
    published = true;
    throwIfOfflineTransferAborted(signal);

    const { uri, size } = await assertNativeTrackIntegrity(
      filePath,
      staged.size,
    );
    throwIfOfflineTransferAborted(signal);
    const nextEntry: OfflineNativeAssetRecord = {
      assetKey,
      entityUid: track.entity_uid ?? null,
      storageId: track.storage_id,
      path: filePath,
      uri,
      playbackUrl: Capacitor.convertFileSrc(uri),
      state: "ready",
      originFingerprint: offlineSourceFingerprint(track),
      requestedDeliveryPolicy: requestedDeliveryPolicy(),
      deliveryPolicy: downloadTarget.effectivePolicy,
      deliveryFormat: downloadTarget.extension,
      deliveryByteLength: size,
      byteLength: size,
      updatedAt: track.updated_at ?? null,
    };

    indexUpdateStarted = true;
    await updateOfflineNativeAssetIndex(profileKey, (current) => {
      throwIfOfflineTransferAborted(signal);
      previousEntries = Object.fromEntries(
        aliases.map((alias) => [alias, current[alias]]),
      );
      const next = { ...current };
      for (const alias of aliases) next[alias] = nextEntry;
      return next;
    });
    committed = true;
    throwIfOfflineTransferAborted(signal);
  } catch (error) {
    if (committed && signal?.aborted) {
      try {
        await updateOfflineNativeAssetIndex(profileKey, (current) => {
          const next = { ...current };
          for (const alias of aliases) {
            if (next[alias]?.path !== filePath) continue;
            const previous = previousEntries[alias];
            if (previous) next[alias] = previous;
            else delete next[alias];
          }
          return next;
        });
      } catch (rollbackError) {
        recordDevLog(
          "offline",
          "failed to roll back a cancelled native asset replacement",
          { path: filePath, error: String(rollbackError) },
          "error",
        );
        throw error;
      }
    }
    await deleteNativeAssetQuietly(stagePath);
    if (published && (!indexUpdateStarted || committed)) {
      await deleteNativeAssetQuietly(filePath);
    }
    throw error;
  }

  const previousPaths = new Set(
    Object.values(previousEntries)
      .map((entry) => entry?.path)
      .filter((path): path is string => Boolean(path) && path !== filePath),
  );
  if (previousPaths.size) {
    try {
      const current = await ensureOfflineNativeAssetIndexLoaded(profileKey);
      const stillReferenced = new Set(
        Object.values(current).map((entry) => entry.path),
      );
      await Promise.all(
        [...previousPaths]
          .filter((path) => !stillReferenced.has(path))
          .map(deleteNativeAssetQuietly),
      );
    } catch (error) {
      recordDevLog(
        "offline",
        "failed to inspect replaced native assets for cleanup",
        { paths: [...previousPaths], error: String(error) },
        "warn",
      );
    }
  }
}

export async function deleteNativeCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<void> {
  if (!isOfflineNativeRuntime) return;
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  let entry: OfflineNativeAssetRecord | undefined;
  await updateOfflineNativeAssetIndex(profileKey, (current) => {
    entry = aliases.map((alias) => current[alias]).find(Boolean);
    if (!entry) return current;
    const next = { ...current };
    for (const alias of aliases) {
      const candidate = current[alias];
      if (candidate?.path === entry.path) {
        next[alias] = { ...candidate, state: "deleting" };
      }
    }
    return next;
  });
  if (entry?.path) {
    try {
      await Filesystem.deleteFile({
        path: entry.path,
        directory: Directory.Data,
      });
    } catch (error) {
      if (!isMissingNativeFileError(error)) {
        recordDevLog(
          "offline",
          "failed to delete cached track asset",
          { path: entry.path, error: String(error) },
          "warn",
        );
        throw error;
      }
    }
  }
  if (!entry) return;
  await updateOfflineNativeAssetIndex(profileKey, (current) => {
    const next = { ...current };
    for (const alias of aliases) {
      const candidate = next[alias];
      if (candidate?.state === "deleting" && candidate.path === entry?.path) {
        delete next[alias];
      }
    }
    return next;
  });
}

export async function clearNativeOfflineAssets(
  profileKey: string,
): Promise<void> {
  if (!isOfflineNativeRuntime) return;
  const failures: unknown[] = [];
  let markedAssets: Record<string, OfflineNativeAssetRecord> = {};
  await updateOfflineNativeAssetIndex(profileKey, (assets) => {
    markedAssets = Object.fromEntries(
      Object.entries(assets).map(([assetKey, asset]) => [
        assetKey,
        { ...asset, state: "deleting" as const },
      ]),
    );
    return markedAssets;
  });
  const deletedPaths = new Set<string>();
  const uniqueAssets = new Map<string, OfflineNativeAssetRecord>();
  for (const asset of Object.values(markedAssets)) {
    uniqueAssets.set(asset.path, asset);
  }
  await Promise.all(
    [...uniqueAssets.values()].map(async (asset) => {
      try {
        await Filesystem.deleteFile({
          path: asset.path,
          directory: Directory.Data,
        });
        deletedPaths.add(asset.path);
      } catch (error) {
        if (isMissingNativeFileError(error)) {
          deletedPaths.add(asset.path);
          return;
        }
        failures.push(error);
        recordDevLog(
          "offline",
          "failed to delete cached asset during clear-all",
          { path: asset.path, error: String(error) },
          "warn",
        );
      }
    }),
  );
  await updateOfflineNativeAssetIndex(profileKey, (assets) => {
    const remaining = { ...assets };
    for (const [assetKey, asset] of Object.entries(assets)) {
      if (asset.state === "deleting" && deletedPaths.has(asset.path)) {
        delete remaining[assetKey];
      }
    }
    return remaining;
  });
  if (failures.length) throw failures[0];
}

export function getNativeOfflinePlaybackUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
  options: { target?: "webview" | "android-native" } = {},
): string | null {
  if (!isOfflineNativeRuntime) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const assets = loadOfflineNativeAssetIndex(profileKey);
  const entry = getOfflineTrackAssetAliases(track, storageId)
    .map((alias) => assets[alias])
    .find(Boolean);
  if (!entry || entry.state === "deleting") return null;
  return options.target === "android-native"
    ? entry.uri || null
    : entry.playbackUrl || null;
}

export function offlineTrackFromIdentity(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): OfflineManifestTrack {
  return typeof track === "object" && track
    ? (track as OfflineManifestTrack)
    : {
        storage_id:
          typeof track === "string"
            ? normalizeIdentityValue(storageId) || normalizeIdentityValue(track)
            : normalizeIdentityValue(storageId),
        title: "",
        artist: "",
        stream_url: "",
        download_url: "",
      };
}
