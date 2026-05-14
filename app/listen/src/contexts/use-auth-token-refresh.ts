import { useEffect } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import {
  AUTH_TOKEN_EVENT,
  getAuthToken,
  getAuthTokenExpiresAt,
  refreshAuthToken,
} from "@/lib/api";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FALLBACK_REFRESH_MS = 45 * 60 * 1000;
const MIN_REFRESH_DELAY_MS = 5_000;

function nextRefreshDelay(): number | null {
  if (!getAuthToken()) return null;
  const expiresAt = getAuthTokenExpiresAt();
  if (!expiresAt) return FALLBACK_REFRESH_MS;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return FALLBACK_REFRESH_MS;
  return Math.max(
    MIN_REFRESH_DELAY_MS,
    expiresMs - Date.now() - REFRESH_MARGIN_MS,
  );
}

export function useAuthTokenRefresh(user: AuthUser | null) {
  useEffect(() => {
    if (!user) return;

    let timer: number | null = null;
    let disposed = false;

    function clearTimer() {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    }

    function schedule() {
      clearTimer();
      const delay = nextRefreshDelay();
      if (delay === null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void refreshAuthToken().finally(() => {
          if (!disposed) schedule();
        });
      }, delay);
    }

    function refreshIfDue() {
      const delay = nextRefreshDelay();
      if (delay !== null && delay <= MIN_REFRESH_DELAY_MS) {
        void refreshAuthToken().finally(() => {
          if (!disposed) schedule();
        });
        return;
      }
      schedule();
    }

    schedule();
    window.addEventListener(AUTH_TOKEN_EVENT, schedule);
    window.addEventListener("online", refreshIfDue);
    document.addEventListener("visibilitychange", refreshIfDue);

    return () => {
      disposed = true;
      clearTimer();
      window.removeEventListener(AUTH_TOKEN_EVENT, schedule);
      window.removeEventListener("online", refreshIfDue);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [user]);
}
