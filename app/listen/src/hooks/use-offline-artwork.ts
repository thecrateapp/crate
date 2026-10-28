import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiUrl } from "@/lib/api";
import { getActiveOfflineProfileKey } from "@/lib/offline-storage";
import {
  readOfflineArtwork,
  discardOfflineArtwork,
} from "@/lib/offline-artwork";
import { offlineArtworkRef } from "@/lib/offline-artwork-identity";
import {
  offlineArtworkVersion,
  subscribeOfflineArtwork,
} from "@/lib/offline-artwork-events";
const noSubscription = () => () => {};
/** Local leases are owned by the image, never serialized into queues or snapshots. */
export function useOfflineArtwork(source: string | null) {
  let ref = offlineArtworkRef(source);
  if (ref && source && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
    try {
      if (
        new URL(source, location.origin).origin !==
        new URL(apiUrl(ref.path), location.origin).origin
      )
        ref = null;
    } catch {
      ref = null;
    }
  }
  const version = useSyncExternalStore(
    ref ? subscribeOfflineArtwork : noSubscription,
    () => offlineArtworkVersion(getActiveOfflineProfileKey(), ref?.key),
    () => "server",
  );
  const profileKey = ref ? getActiveOfflineProfileKey() : null;
  const key = ref && profileKey ? `${profileKey}:${ref.key}:${version}` : "";
  const [local, setLocal] = useState<{ key: string; src: string | null }>({
    key: "",
    src: null,
  });
  const refKey = ref?.key,
    refPath = ref?.path;
  useEffect(() => {
    if (!key || !profileKey || !refKey || !refPath) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void readOfflineArtwork(profileKey, { key: refKey, path: refPath })
      .then((result) => {
        if (disposed) {
          result?.release();
          return;
        }
        release = result?.release;
        setLocal({ key, src: result?.src ?? null });
      })
      .catch(() => {
        if (!disposed) setLocal({ key, src: null });
      });
    return () => {
      disposed = true;
      release?.();
    };
  }, [key, profileKey, refKey, refPath]);
  const invalidate = useCallback(() => {
    if (!profileKey || !refKey || !refPath) return;
    setLocal((current) =>
      current.key === key ? { ...current, src: null } : current,
    );
    void discardOfflineArtwork(profileKey, {
      key: refKey,
      path: refPath,
    }).catch(() => {});
  }, [profileKey, refKey, refPath, key]);
  return {
    invalidate,
    src: key && local.key === key ? local.src : null,
    pending: Boolean(key && local.key !== key),
    profileKey,
    offline: Boolean(
      ref && typeof navigator !== "undefined" && !navigator.onLine,
    ),
  };
}
