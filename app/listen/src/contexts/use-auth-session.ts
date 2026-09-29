import { useCallback, useEffect, useRef, useState } from "react";

import { type AuthUser } from "@/contexts/auth-context";
import { applyAuthenticatedUser } from "@/contexts/auth-runtime";
import { api } from "@/lib/api";
import { getCurrentServerId } from "@/lib/server-store";
import { ApiError } from "../../../shared/web/api";

const AUTH_RETRY_BASE_DELAY_MS = 1_500;
const AUTH_RETRY_MAX_DELAY_MS = 30_000;
const AUTH_RETRY_MAX_ATTEMPTS = 5;
const AUTH_RETRY_JITTER_RATIO = 0.2;

function authRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    AUTH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    AUTH_RETRY_MAX_DELAY_MS,
  );
  const jitter =
    exponentialDelay * AUTH_RETRY_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponentialDelay + jitter));
}

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const userRef = useRef<AuthUser | null>(null);
  const authRequestRef = useRef<AbortController | null>(null);
  const authGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);

  const setCurrentUser = useCallback((nextUser: AuthUser | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  }, []);

  const fetchSession = useCallback(async (): Promise<AuthUser | null> => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    authRequestRef.current?.abort();
    const generation = ++authGenerationRef.current;
    const serverId = getCurrentServerId();
    const controller = new AbortController();
    authRequestRef.current = controller;
    setLoading(true);

    try {
      const data = await api<AuthUser>("/api/auth/me", "GET", undefined, {
        signal: controller.signal,
      });
      if (
        generation !== authGenerationRef.current ||
        serverId !== getCurrentServerId()
      ) {
        return userRef.current;
      }
      const nextUser = data && data.id ? data : null;
      setCurrentUser(nextUser);
      retryAttemptRef.current = 0;
      setSessionUnavailable(false);
      applyAuthenticatedUser(nextUser);
      return nextUser;
    } catch (error) {
      if (
        generation !== authGenerationRef.current ||
        serverId !== getCurrentServerId() ||
        controller.signal.aborted ||
        (error as Error).name === "AbortError"
      ) {
        return userRef.current;
      }
      const isRejectedSession =
        error instanceof ApiError && [401, 403].includes(error.status);
      if (isRejectedSession) {
        setCurrentUser(null);
        retryAttemptRef.current = 0;
        setSessionUnavailable(false);
        applyAuthenticatedUser(null);
        return null;
      }
      setSessionUnavailable(true);
      if (retryAttemptRef.current < AUTH_RETRY_MAX_ATTEMPTS) {
        retryAttemptRef.current += 1;
        const retryDelay = authRetryDelay(retryAttemptRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void fetchSession();
        }, retryDelay);
      } else if (!userRef.current) {
        // There is no authenticated user to preserve. Stop showing the boot
        // spinner and let ProtectedRoute redirect to login.
        setSessionUnavailable(false);
      }
      return userRef.current;
    } finally {
      if (authRequestRef.current === controller) {
        authRequestRef.current = null;
        // The identity guard prevents an older request from clearing a newer one.
        // react-doctor-disable-next-line no-loading-flag-reset-outside-finally
        setLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(async (): Promise<AuthUser | null> => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
    return fetchSession();
  }, [fetchSession]);

  const resetForServerTransition = useCallback(
    (hasSession: boolean) => {
      authGenerationRef.current += 1;
      authRequestRef.current?.abort();
      authRequestRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptRef.current = 0;
      setCurrentUser(null);
      setSessionUnavailable(false);
      // A token-bearing destination will immediately start a fresh session check.
      setLoading(hasSession);
    },
    [setCurrentUser],
  );

  useEffect(() => {
    void refetch();
    return () => {
      authGenerationRef.current += 1;
      authRequestRef.current?.abort();
      authRequestRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [refetch]);

  return {
    user,
    loading,
    sessionUnavailable,
    refetch,
    resetForServerTransition,
  };
}
