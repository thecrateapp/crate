import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { isNative } from "@/lib/capacitor-runtime";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import {
  readOfflineStoreItem,
  writeOfflineStoreItem,
} from "@/lib/offline-store";
import type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
} from "./offline-model";
import { EMPTY_OFFLINE_SNAPSHOT } from "./offline-model";

export type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineManifest,
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

const OFFLINE_META_PREFIX = "listen-offline-meta::";
const OFFLINE_NATIVE_ASSET_PREFIX = "listen-offline-native-assets::";
const OFFLINE_ACTIVE_PROFILE_KEY = "listen-offline-active-profile";
const OFFLINE_CACHE_PREFIX = "crate-listen-offline-media::";
const OFFLINE_NATIVE_META_DIR = "offline-meta";
const OFFLINE_NATIVE_SNAPSHOT_PREFIX = "offline-index-";
const OFFLINE_NATIVE_ASSET_FILE_PREFIX = "offline-assets-";

const nativeSnapshotCache = new Map<string, OfflineSnapshot>();
const nativeAssetIndexCache = new Map<
  string,
  Record<string, OfflineNativeAssetRecord>
>();
const nativeSnapshotLoaders = new Map<string, Promise<OfflineSnapshot>>();
const nativeAssetIndexLoaders = new Map<
  string,
  Promise<Record<string, OfflineNativeAssetRecord>>
>();
// Concurrent writes for the same key (e.g. two cacheNativeTrackAsset()
// calls racing to read-modify-write the per-profile asset index, or two
// snapshot saves in quick succession) aren't guaranteed to land on disk in
// the order they were issued — whichever write happens to finish last
// wins, even if it was issued first with an older, less complete value.
// That silently reverts anything a later write already applied. Chaining
// writes per key keeps them landing on disk in issue order.
function createKeyedWriteChain(): (
  key: string,
  write: () => Promise<void>,
) => Promise<void> {
  const chains = new Map<string, Promise<void>>();
  return (key, write) => {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(write, write);
    chains.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}

const enqueueNativeAssetIndexWrite = createKeyedWriteChain();
const enqueueNativeSnapshotWrite = createKeyedWriteChain();

export function getOfflineItemKey(
  kind: OfflineItemKind,
  entityId: string | number,
): string {
  return `${kind}:${entityId}`;
}

export function getOfflineCacheName(profileKey: string): string {
  return `${OFFLINE_CACHE_PREFIX}${profileKey}`;
}

export function getActiveOfflineProfileKey(): string | null {
  return readOfflineStoreItem(OFFLINE_ACTIVE_PROFILE_KEY);
}

export function setActiveOfflineProfileKey(profileKey: string | null): void {
  writeOfflineStoreItem(OFFLINE_ACTIVE_PROFILE_KEY, profileKey);
}

function getOfflineNativeAssetStorageKey(profileKey: string): string {
  return `${OFFLINE_NATIVE_ASSET_PREFIX}${profileKey}`;
}

function getOfflineNativeSnapshotPath(profileKey: string): string {
  return `${OFFLINE_NATIVE_META_DIR}/${OFFLINE_NATIVE_SNAPSHOT_PREFIX}${profileKey}.json`;
}

function getOfflineNativeAssetIndexPath(profileKey: string): string {
  return `${OFFLINE_NATIVE_META_DIR}/${OFFLINE_NATIVE_ASSET_FILE_PREFIX}${profileKey}.json`;
}

function tryParseOfflineSnapshot(raw: string | null): OfflineSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.items !== "object"
    ) {
      return null;
    }
    return normalizeOfflineSnapshot({
      items: parsed.items as Record<string, OfflineItemRecord>,
    });
  } catch {
    return null;
  }
}

function parseOfflineSnapshot(raw: string | null): OfflineSnapshot {
  return tryParseOfflineSnapshot(raw) ?? EMPTY_OFFLINE_SNAPSHOT;
}

function normalizeOfflineItemRecord(
  item: OfflineItemRecord,
): OfflineItemRecord {
  const normalizedTracks = Array.isArray(item.tracks) ? item.tracks : [];
  const aliasToAssetKey = new Map<string, string>();
  for (const track of normalizedTracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    aliasToAssetKey.set(assetKey, assetKey);
    for (const alias of getOfflineTrackAssetAliases(track)) {
      aliasToAssetKey.set(alias, assetKey);
    }
  }

  const normalizedReadyAssetKeys = Array.from(
    new Set(
      (item.readyAssetKeys || item.readyStorageIds || [])
        .map(
          (value) =>
            aliasToAssetKey.get(value) || normalizeIdentityValue(value),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const canonicalEntityId =
    item.kind === "track"
      ? getOfflineTrackAssetKey(normalizedTracks[0] ?? null) ||
        normalizeIdentityValue(item.entityId) ||
        String(item.entityId)
      : String(item.entityId);

  return {
    ...item,
    key: getOfflineItemKey(item.kind, canonicalEntityId),
    entityId: canonicalEntityId,
    readyAssetKeys:
      normalizedReadyAssetKeys.length ||
      item.readyAssetKeys ||
      item.readyStorageIds
        ? normalizedReadyAssetKeys
        : undefined,
    readyStorageIds: undefined,
    tracks: normalizedTracks,
  };
}

export function normalizeOfflineSnapshot(
  snapshot: OfflineSnapshot,
): OfflineSnapshot {
  const items: Record<string, OfflineItemRecord> = {};
  for (const record of Object.values(snapshot.items || {})) {
    const normalized = normalizeOfflineItemRecord(record);
    items[normalized.key] = normalized;
  }
  return { items };
}

function tryParseOfflineNativeAssetIndex(
  raw: string | null,
): Record<string, OfflineNativeAssetRecord> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, OfflineNativeAssetRecord>)
      : null;
  } catch {
    return null;
  }
}

function parseOfflineNativeAssetIndex(
  raw: string | null,
): Record<string, OfflineNativeAssetRecord> {
  return tryParseOfflineNativeAssetIndex(raw) ?? {};
}

function getLegacyOfflineSnapshot(profileKey: string): OfflineSnapshot {
  if (typeof window === "undefined") return EMPTY_OFFLINE_SNAPSHOT;
  try {
    return parseOfflineSnapshot(
      localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`),
    );
  } catch {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
}

function getLegacyOfflineNativeAssetIndex(
  profileKey: string,
): Record<string, OfflineNativeAssetRecord> {
  if (typeof window === "undefined") return {};
  try {
    return parseOfflineNativeAssetIndex(
      localStorage.getItem(getOfflineNativeAssetStorageKey(profileKey)),
    );
  } catch {
    return {};
  }
}

function clearLegacyOfflineSnapshot(profileKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${OFFLINE_META_PREFIX}${profileKey}`);
  } catch {
    // ignore persistence failures
  }
}

function clearLegacyOfflineNativeAssetIndex(profileKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getOfflineNativeAssetStorageKey(profileKey));
  } catch {
    // ignore persistence failures
  }
}

async function ensureOfflineNativeMetaDir(): Promise<void> {
  await Filesystem.mkdir({
    path: OFFLINE_NATIVE_META_DIR,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {
    // directory may already exist
  });
}

async function readNativeJsonFile(path: string): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === "string" ? result.data : null;
  } catch {
    return null;
  }
}

async function readRecoverableNativeJson<T>(
  path: string,
  parse: (raw: string | null) => T | null,
): Promise<T | null> {
  for (const candidate of [path, `${path}.next`, `${path}.backup`]) {
    // Recovery candidates are deliberately ordered: the canonical file is
    // authoritative, followed by the verified pending promotion and then the
    // previous known-good version retained during an interrupted replacement.
    // react-doctor-disable-next-line async-await-in-loop
    const parsed = parse(await readNativeJsonFile(candidate));
    if (parsed !== null) return parsed;
  }
  return null;
}

async function writeNativeJsonFile(
  path: string,
  payload: unknown,
): Promise<void> {
  await ensureOfflineNativeMetaDir();
  const nextPath = `${path}.next`;
  const backupPath = `${path}.backup`;
  const data = JSON.stringify(payload);
  await Filesystem.writeFile({
    path: nextPath,
    directory: Directory.Data,
    recursive: true,
    encoding: Encoding.UTF8,
    data,
  });
  if ((await readNativeJsonFile(nextPath)) !== data) {
    throw new Error(`Failed to verify native metadata write: ${path}`);
  }

  const hasCurrent = (await readNativeJsonFile(path)) !== null;
  await Filesystem.deleteFile({
    path: backupPath,
    directory: Directory.Data,
  }).catch(() => undefined);
  if (hasCurrent) {
    await Filesystem.rename({
      from: path,
      to: backupPath,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }
  try {
    await Filesystem.rename({
      from: nextPath,
      to: path,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  } catch (error) {
    if (hasCurrent) {
      await Filesystem.rename({
        from: backupPath,
        to: path,
        directory: Directory.Data,
        toDirectory: Directory.Data,
      }).catch(() => undefined);
    }
    throw error;
  }
  await Filesystem.deleteFile({
    path: backupPath,
    directory: Directory.Data,
  }).catch(() => undefined);
}

async function ensureOfflineSnapshotLoaded(
  profileKey: string,
): Promise<OfflineSnapshot> {
  const cached = nativeSnapshotCache.get(profileKey);
  if (cached) return cached;
  const inFlight = nativeSnapshotLoaders.get(profileKey);
  if (inFlight) return inFlight;

  const loader = (async () => {
    const filePath = getOfflineNativeSnapshotPath(profileKey);
    const persisted = await readRecoverableNativeJson(
      filePath,
      tryParseOfflineSnapshot,
    );
    let snapshot = persisted ?? EMPTY_OFFLINE_SNAPSHOT;
    if (persisted == null) {
      const legacy = getLegacyOfflineSnapshot(profileKey);
      snapshot = legacy;
      if (Object.keys(legacy.items).length) {
        await writeNativeJsonFile(filePath, legacy);
        clearLegacyOfflineSnapshot(profileKey);
      }
    }
    nativeSnapshotCache.set(profileKey, snapshot);
    nativeSnapshotLoaders.delete(profileKey);
    return snapshot;
  })();

  nativeSnapshotLoaders.set(profileKey, loader);
  return loader;
}

export async function ensureOfflineNativeAssetIndexLoaded(
  profileKey: string,
): Promise<Record<string, OfflineNativeAssetRecord>> {
  const cached = nativeAssetIndexCache.get(profileKey);
  if (cached) return cached;
  const inFlight = nativeAssetIndexLoaders.get(profileKey);
  if (inFlight) return inFlight;

  const loader = (async () => {
    const filePath = getOfflineNativeAssetIndexPath(profileKey);
    const persisted = await readRecoverableNativeJson(
      filePath,
      tryParseOfflineNativeAssetIndex,
    );
    let assets = persisted ?? {};
    if (persisted == null) {
      const legacy = getLegacyOfflineNativeAssetIndex(profileKey);
      assets = legacy;
      if (Object.keys(legacy).length) {
        await writeNativeJsonFile(filePath, legacy);
        clearLegacyOfflineNativeAssetIndex(profileKey);
      }
    }
    nativeAssetIndexCache.set(profileKey, assets);
    nativeAssetIndexLoaders.delete(profileKey);
    return assets;
  })();

  nativeAssetIndexLoaders.set(profileKey, loader);
  return loader;
}

// saveOfflineNativeAssetIndex only serializes the *write* of a snapshot the
// caller already computed — if that snapshot was read long before (e.g.
// after an intervening Filesystem.deleteFile/downloadFile await), it can
// still be stale relative to another mutation that landed on disk in the
// meantime, silently reverting it. This reads the *current* state from
// inside the very write-chain slot being written, so `mutate` always sees
// every previously-queued mutation already applied.
export async function updateOfflineNativeAssetIndex(
  profileKey: string,
  mutate: (
    current: Record<string, OfflineNativeAssetRecord>,
  ) =>
    | Record<string, OfflineNativeAssetRecord>
    | Promise<Record<string, OfflineNativeAssetRecord>>,
): Promise<void> {
  if (!isNative) {
    const next = await mutate(loadOfflineNativeAssetIndex(profileKey));
    await saveOfflineNativeAssetIndex(profileKey, next);
    return;
  }
  await enqueueNativeAssetIndexWrite(profileKey, async () => {
    const current = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    const next = await mutate(current);
    nativeAssetIndexCache.set(profileKey, next);
    await writeNativeJsonFile(getOfflineNativeAssetIndexPath(profileKey), next);
  });
}

export function loadOfflineNativeAssetIndex(
  profileKey: string,
): Record<string, OfflineNativeAssetRecord> {
  if (isNative) {
    return nativeAssetIndexCache.get(profileKey) ?? {};
  }
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(
      getOfflineNativeAssetStorageKey(profileKey),
    );
    return parseOfflineNativeAssetIndex(raw);
  } catch {
    return {};
  }
}

export async function saveOfflineNativeAssetIndex(
  profileKey: string,
  assets: Record<string, OfflineNativeAssetRecord>,
): Promise<void> {
  if (isNative) {
    // The in-memory cache is the source of truth for the running session
    // and updates immediately regardless of how the disk write below
    // goes. Callers that just finished writing a media file to disk
    // (cacheNativeTrackAsset, deleteNativeCachedTrackAsset) await this so
    // the index write isn't a fire-and-forget promise the process can be
    // killed before flushing — otherwise a completed download can end up
    // as an orphaned file on disk with no matching index entry.
    nativeAssetIndexCache.set(profileKey, assets);
    await enqueueNativeAssetIndexWrite(profileKey, () =>
      writeNativeJsonFile(getOfflineNativeAssetIndexPath(profileKey), assets),
    );
    return;
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getOfflineNativeAssetStorageKey(profileKey),
      JSON.stringify(assets),
    );
  } catch {
    // ignore persistence failures
  }
}

export function loadOfflineSnapshot(
  profileKey: string | null,
): OfflineSnapshot {
  if (!profileKey || typeof window === "undefined") {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
  if (isNative) {
    return nativeSnapshotCache.get(profileKey) ?? EMPTY_OFFLINE_SNAPSHOT;
  }
  try {
    const raw = localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`);
    return parseOfflineSnapshot(raw);
  } catch {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
}

export function saveOfflineSnapshot(
  profileKey: string | null,
  snapshot: OfflineSnapshot,
): Promise<void> {
  if (!profileKey || typeof window === "undefined") return Promise.resolve();
  const normalized = normalizeOfflineSnapshot(snapshot);
  if (isNative) {
    nativeSnapshotCache.set(profileKey, normalized);
    // Callers don't have to await this (it's routinely fired from a
    // debounced coalescing writer), but it must still land on disk in the
    // order it was issued — otherwise a later, more complete snapshot
    // write finishing first could get reverted by an earlier one that
    // just happened to take longer.
    return enqueueNativeSnapshotWrite(profileKey, () =>
      writeNativeJsonFile(getOfflineNativeSnapshotPath(profileKey), normalized),
    );
  }
  try {
    localStorage.setItem(
      `${OFFLINE_META_PREFIX}${profileKey}`,
      JSON.stringify(normalized),
    );
  } catch {
    // ignore persistence failures; cache may still hold usable media
  }
  return Promise.resolve();
}

export async function hydrateOfflineProfileState(
  profileKey: string | null,
): Promise<OfflineSnapshot> {
  if (!profileKey) return EMPTY_OFFLINE_SNAPSHOT;
  if (!isNative) return loadOfflineSnapshot(profileKey);
  const [snapshot] = await Promise.all([
    ensureOfflineSnapshotLoaded(profileKey),
    ensureOfflineNativeAssetIndexLoaded(profileKey),
  ]);
  return snapshot;
}
