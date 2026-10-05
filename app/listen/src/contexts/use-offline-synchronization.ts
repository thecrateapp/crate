import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { onAppResume } from "@/lib/capacitor";
import type { OfflineItemKind, OfflineSnapshot } from "@/lib/offline";
import {
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
  isOfflineBusy,
} from "@/lib/offline";

const HIDDEN_ABORT_DELAY_MS = 10_000;

type Enqueue = <T>(fn: () => Promise<T>) => Promise<T>;
type SyncManifestIntoItem = (
  kind: OfflineItemKind,
  entityId: string | number,
  manifestPath: string,
) => Promise<void>;

interface UseOfflineSynchronizationOptions {
  enabled: boolean;
  enqueue: Enqueue;
  profileKey: string | null;
  snapshot: OfflineSnapshot;
  snapshotRef: MutableRefObject<OfflineSnapshot>;
  supported: boolean;
  syncManifestIntoItem: SyncManifestIntoItem;
  transferAbortRef: MutableRefObject<AbortController | null>;
}

export function useOfflineSynchronization({
  enabled,
  enqueue,
  profileKey,
  snapshot,
  snapshotRef,
  supported,
  syncManifestIntoItem,
  transferAbortRef,
}: UseOfflineSynchronizationOptions) {
  const [syncing, setSyncing] = useState(false);
  const resumedProfileRef = useRef<string | null>(null);

  const performSyncAll = useCallback(async () => {
    if (!enabled || !profileKey || !supported) return;
    const items = Object.values(snapshotRef.current.items);
    if (!items.length) return;
    setSyncing(true);
    let firstError: unknown = null;
    try {
      for (const item of items) {
        try {
          if (item.kind === "track") {
            const firstTrack = item.tracks[0];
            const trackRef =
              getOfflineTrackAssetKey(firstTrack) || item.entityId;
            const manifestPaths = getOfflineTrackManifestPaths(
              firstTrack ?? item.entityId,
            );
            let synced = false;
            let lastError: unknown = null;
            for (const manifestPath of manifestPaths) {
              try {
                await syncManifestIntoItem("track", trackRef, manifestPath);
                synced = true;
                break;
              } catch (error) {
                lastError = error;
              }
            }
            if (!synced) {
              throw lastError instanceof Error
                ? lastError
                : new Error("Failed to fetch offline track manifest");
            }
          } else if (item.kind === "album") {
            // Album and playlist manifests update the same item snapshot; keep
            // the outer sync sequential to avoid lost updates.
            // react-doctor-disable-next-line async-await-in-loop
            await syncManifestIntoItem(
              "album",
              item.entityId,
              `/api/offline/albums/${item.entityId}/manifest`,
            );
          } else if (item.kind === "playlist") {
            // Album and playlist manifests update the same item snapshot; keep
            // the outer sync sequential to avoid lost updates.
            // react-doctor-disable-next-line async-await-in-loop
            await syncManifestIntoItem(
              "playlist",
              item.entityId,
              `/api/offline/playlists/${item.entityId}/manifest`,
            );
          } else if (item.kind === "crate") {
            // Crate manifests use the same track transfer pipeline as albums and playlists.
            // Keep the outer sync sequential so snapshot writes cannot race each other.
            // react-doctor-disable-next-line async-await-in-loop
            await syncManifestIntoItem(
              "crate",
              item.entityId,
              `/api/offline/crates/${encodeURIComponent(
                item.entityId,
              )}/manifest`,
            );
          }
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    } finally {
      setSyncing(false);
    }
  }, [enabled, profileKey, snapshotRef, supported, syncManifestIntoItem]);

  const syncAll = useCallback(
    () => (enabled ? enqueue(performSyncAll) : Promise.resolve()),
    [enabled, enqueue, performSyncAll],
  );

  const enqueueSync = useCallback(() => {
    void syncAll();
  }, [syncAll]);

  useEffect(() => {
    if (!enabled || !profileKey || !supported) {
      resumedProfileRef.current = null;
      return;
    }
    if (resumedProfileRef.current === profileKey) return;
    const hasPendingItems = Object.values(snapshot.items).some((item) =>
      isOfflineBusy(item.state),
    );
    if (!hasPendingItems) return;
    resumedProfileRef.current = profileKey;
    // Rehydrated work must enter the shared queue owned by the runtime;
    // invoking it here is the synchronization side effect, not parent data.
    // react-doctor-disable-next-line no-pass-data-to-parent
    enqueueSync();
  }, [enabled, enqueueSync, profileKey, snapshot.items, supported]);

  useEffect(() => {
    if (!enabled || !profileKey || !supported) return;
    const handleOnline = () => {
      enqueueSync();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener(
      "crate:network-restored",
      handleOnline as EventListener,
    );
    const disposeResume = onAppResume(handleOnline);
    // A quick glance at another app (notification shade, switching to
    // check a message) shouldn't nuke an in-flight download — only treat
    // this as a real backgrounding, worth aborting to free the connection
    // before the OS reclaims it, once we've stayed hidden for a bit.
    let hiddenAbortTimer: number | null = null;
    const clearHiddenAbortTimer = () => {
      if (hiddenAbortTimer === null) return;
      window.clearTimeout(hiddenAbortTimer);
      hiddenAbortTimer = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearHiddenAbortTimer();
        hiddenAbortTimer = window.setTimeout(() => {
          hiddenAbortTimer = null;
          transferAbortRef.current?.abort();
        }, HIDDEN_ABORT_DELAY_MS);
      } else {
        clearHiddenAbortTimer();
        enqueueSync();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(
        "crate:network-restored",
        handleOnline as EventListener,
      );
      document.removeEventListener("visibilitychange", handleVisibility);
      clearHiddenAbortTimer();
      disposeResume();
    };
  }, [enabled, enqueueSync, profileKey, supported, transferAbortRef]);

  return { syncing, syncAll };
}
