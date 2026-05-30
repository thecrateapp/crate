import { useEffect, useState } from "react";

import {
  CONNECT_ENABLED_EVENT,
  fetchCrateConnectPreferences,
  isCrateConnectEnabled,
  resetCrateConnectPreferences,
} from "@/lib/crate-connect";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";

export function useCrateConnectEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => isCrateConnectEnabled());

  useEffect(() => {
    const refresh = () => setEnabled(isCrateConnectEnabled());
    const reset = () => {
      resetCrateConnectPreferences();
      setEnabled(false);
    };
    let cancelled = false;
    void fetchCrateConnectPreferences()
      .then(({ enabled: nextEnabled }) => {
        if (!cancelled) setEnabled(nextEnabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    window.addEventListener(CONNECT_ENABLED_EVENT, refresh);
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
    return () => {
      cancelled = true;
      window.removeEventListener(CONNECT_ENABLED_EVENT, refresh);
      window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
    };
  }, []);

  return enabled;
}
