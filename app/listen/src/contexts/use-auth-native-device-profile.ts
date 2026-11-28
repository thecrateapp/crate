import { useEffect, useRef } from "react";

import type { AuthContextValue, AuthUser } from "@/contexts/auth-context";
import {
  handleNativeDeviceProfileChange,
  isNativeDeviceProfileRuntime,
  retireNativeDeviceProfile,
  subscribeNativeDeviceProfileChanges,
  syncNativeDeviceProfile,
  updateNativeDeviceProfilePreferences,
} from "@/lib/native-device-profile";
import { OFFLINE_ACTIVE_PROFILE_EVENT } from "@/lib/offline-storage";
import { PLAYER_PLAYBACK_PREFS_EVENT } from "@/lib/player-playback-prefs";
import { getCurrentServerId } from "@/lib/server-store";

/**
 * Keeps the Android device profile in step with the auth lifecycle: mint or
 * refresh it after sign-in, session restore and server switch, push delivery
 * and offline profile changes, re-mint when the service reports the token
 * rejected, and retire it when the session is gone. Logout retires it from
 * AuthProvider before the session is revoked. No-op off Android.
 */
export function useAuthNativeDeviceProfile(
  user: AuthUser | null,
  accessMode: AuthContextValue["accessMode"],
) {
  // Ask the server whether the stored token is still listed once per
  // server and user in this app session; later syncs only read native state.
  const verifiedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isNativeDeviceProfileRuntime()) return;
    if (user) {
      const scope = `${getCurrentServerId() ?? ""}:${user.id}`;
      const verify = verifiedScopeRef.current !== scope;
      verifiedScopeRef.current = scope;
      void syncNativeDeviceProfile({ verify });
      return;
    }
    if (accessMode === "unauthenticated") {
      verifiedScopeRef.current = null;
      void retireNativeDeviceProfile();
    }
  }, [user, accessMode]);

  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn || !isNativeDeviceProfileRuntime()) return;

    const handlePlaybackPrefs = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail && "playbackDeliveryPolicy" in detail) {
        void updateNativeDeviceProfilePreferences();
      }
    };
    const handleOfflineProfile = () => {
      void updateNativeDeviceProfilePreferences();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void syncNativeDeviceProfile();
      }
    };
    const unsubscribe = subscribeNativeDeviceProfileChanges((status) => {
      void handleNativeDeviceProfileChange(status);
    });

    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, handlePlaybackPrefs);
    window.addEventListener(OFFLINE_ACTIVE_PROFILE_EVENT, handleOfflineProfile);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener(
        PLAYER_PLAYBACK_PREFS_EVENT,
        handlePlaybackPrefs,
      );
      window.removeEventListener(
        OFFLINE_ACTIVE_PROFILE_EVENT,
        handleOfflineProfile,
      );
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [signedIn]);
}
