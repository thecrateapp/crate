import { useEffect, useState } from "react";

import {
  CONNECT_ENABLED_EVENT,
  fetchCrateConnectPreferences,
  isCrateConnectEnabled,
  refreshCrateConnectPreferences,
  resetCrateConnectPreferences,
} from "@/lib/crate-connect";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { onCacheInvalidation } from "@/lib/cache";

export function useCrateConnectEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => isCrateConnectEnabled());

  useEffect(() => {
    const refresh = () => setEnabled(isCrateConnectEnabled());
    const reset = () => {
      resetCrateConnectPreferences();
      setEnabled(false);
    };
    let cancelled = false;
    const refreshFromServer = (force = false) => {
      const request = force
        ? refreshCrateConnectPreferences()
        : fetchCrateConnectPreferences();
      void request
        .then(({ enabled: nextEnabled }) => {
          if (!cancelled) setEnabled(nextEnabled);
        })
        .catch(() => {
          if (!cancelled && !force) setEnabled(false);
        });
    };
    refreshFromServer();
    window.addEventListener(CONNECT_ENABLED_EVENT, refresh);
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
    const unsubscribeCache = onCacheInvalidation((scope) => {
      if (scope === "connect:preferences") refreshFromServer(true);
    });
    const refreshOnFocus = () => refreshFromServer(true);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      unsubscribeCache();
      window.removeEventListener(CONNECT_ENABLED_EVENT, refresh);
      window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  return enabled;
}
