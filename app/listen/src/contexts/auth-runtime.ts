import type { AuthUser } from "@/contexts/auth-context";
import {
  primeOfflineRuntimeProfile,
  setActiveOfflineProfileKey,
  syncOfflineProfileToServiceWorker,
} from "@/lib/offline";
import {
  getStoredAuthUserId,
  removeStoredAuthUserId,
  setStoredAuthUserId,
} from "@/lib/auth-user-storage";
import { clearQueue as clearPlayEventQueue } from "@/lib/play-event-queue";
import {
  LEGACY_RECENTLY_PLAYED_KEY,
  LEGACY_STORAGE_KEY,
  RECENTLY_PLAYED_KEY,
  STORAGE_KEY,
} from "@/contexts/player-utils";

export const AUTH_RUNTIME_RESET_EVENT = "crate:auth-runtime-reset";

function notifyAuthRuntimeReset(
  reason: "logout" | "user-change" | "unauthenticated",
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_RUNTIME_RESET_EVENT, { detail: { reason } }),
  );
}

function safeRemoveStorageItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export function resetPlaybackPersistence() {
  [
    STORAGE_KEY,
    RECENTLY_PLAYED_KEY,
    LEGACY_STORAGE_KEY,
    LEGACY_RECENTLY_PLAYED_KEY,
  ].forEach(safeRemoveStorageItem);
}

export function resetStoredAuthUser() {
  removeStoredAuthUserId();
}

export function applyAuthenticatedUser(user: AuthUser | null) {
  if (user?.id) {
    const previousUserId = getStoredAuthUserId();
    if (previousUserId && previousUserId !== String(user.id)) {
      notifyAuthRuntimeReset("user-change");
      resetPlaybackPersistence();
      clearPlayEventQueue();
    }
    setStoredAuthUserId(user.id);
    void primeOfflineRuntimeProfile();
    return;
  }

  setActiveOfflineProfileKey(null);
  void syncOfflineProfileToServiceWorker(null);
  notifyAuthRuntimeReset("unauthenticated");
}

export function clearAuthRuntime(
  options: {
    clearStoredUser?: boolean;
    reason?: "logout" | "user-change" | "unauthenticated";
  } = {},
) {
  notifyAuthRuntimeReset(options.reason ?? "logout");
  const { clearStoredUser = true } = options;
  resetPlaybackPersistence();
  if (clearStoredUser) {
    resetStoredAuthUser();
  }
  clearPlayEventQueue();
  setActiveOfflineProfileKey(null);
  void syncOfflineProfileToServiceWorker(null);
}
