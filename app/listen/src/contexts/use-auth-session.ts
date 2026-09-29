import { useCallback, useEffect, useRef, useState } from "react";

import { type AuthUser } from "@/contexts/auth-context";
import { applyAuthenticatedUser } from "@/contexts/auth-runtime";
import { api, AUTH_SESSION_REJECTED_EVENT, getApiBase } from "@/lib/api";
import { getCurrentServer, getCurrentServerId } from "@/lib/server-store";
import {
  deriveOfflineProfileKey,
  hasOfflinePlaybackContent,
  isOfflineSupported,
} from "@/lib/offline";
import {
  getOfflineIdentityForServer,
  persistVerifiedOfflineIdentity,
  revokeOfflineIdentityForServer,
  type LocalOfflineIdentity,
} from "@/lib/offline-identity";
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
  const [accessMode, setAccessMode] = useState<
    "loading" | "authenticated" | "offline" | "unauthenticated"
  >("loading");
  const [offlineIdentity, setOfflineIdentity] =
    useState<LocalOfflineIdentity | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const authRequestRef = useRef<AbortController | null>(null);
  const authGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);

  const setCurrentUser = useCallback((nextUser: AuthUser | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  }, []);

  const getCurrentIdentityScope = useCallback(() => {
    const server = getCurrentServer();
    return {
      serverId: getCurrentServerId() ?? "web",
      serverUrl: server?.url || getApiBase() || window.location.origin,
    };
  }, []);

  const restoreOfflineIdentity = useCallback(async () => {
    if (!isOfflineSupported()) return null;
    const scope = getCurrentIdentityScope();
    const identity = getOfflineIdentityForServer(
      scope.serverId,
      scope.serverUrl,
    );
    if (!identity || !(await hasOfflinePlaybackContent(identity.profileKey))) {
      return null;
    }
    const currentScope = getCurrentIdentityScope();
    if (
      scope.serverId !== currentScope.serverId ||
      scope.serverUrl !== currentScope.serverUrl
    ) {
      return null;
    }
    return identity;
  }, [getCurrentIdentityScope]);

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
      if (nextUser) {
        const scope = getCurrentIdentityScope();
        const profileKey = deriveOfflineProfileKey(
          nextUser.id,
          scope.serverUrl,
        );
        if (isOfflineSupported()) {
          persistVerifiedOfflineIdentity({
            ...scope,
            userId: nextUser.id,
            profileKey,
          });
        }
        setOfflineIdentity(null);
        setAccessMode("authenticated");
      } else {
        const scope = getCurrentIdentityScope();
        revokeOfflineIdentityForServer(scope.serverId);
        setOfflineIdentity(null);
        setAccessMode("unauthenticated");
      }
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
        revokeOfflineIdentityForServer(getCurrentIdentityScope().serverId);
        setOfflineIdentity(null);
        setAccessMode("unauthenticated");
        applyAuthenticatedUser(null);
        return null;
      }
      setSessionUnavailable(true);
      if (!userRef.current) {
        const localIdentity = await restoreOfflineIdentity().catch(() => null);
        if (
          generation === authGenerationRef.current &&
          serverId === getCurrentServerId()
        ) {
          setOfflineIdentity(localIdentity);
          setAccessMode(localIdentity ? "offline" : "unauthenticated");
        }
      }
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
  }, [getCurrentIdentityScope, restoreOfflineIdentity, setCurrentUser]);

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
      setOfflineIdentity(null);
      setAccessMode(hasSession ? "loading" : "unauthenticated");
      setSessionUnavailable(false);
      setLoading(hasSession);
    },
    [setCurrentUser],
  );

  useEffect(() => {
    const handleSessionRejected = (event: Event) => {
      const serverId = (event as CustomEvent<{ serverId: string | null }>)
        .detail?.serverId;
      if (serverId !== getCurrentServerId()) return;

      authGenerationRef.current += 1;
      authRequestRef.current?.abort();
      authRequestRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptRef.current = 0;
      setCurrentUser(null);
      setOfflineIdentity(null);
      setAccessMode("unauthenticated");
      setSessionUnavailable(false);
      setLoading(false);
      applyAuthenticatedUser(null);
    };

    window.addEventListener(AUTH_SESSION_REJECTED_EVENT, handleSessionRejected);
    return () =>
      window.removeEventListener(
        AUTH_SESSION_REJECTED_EVENT,
        handleSessionRejected,
      );
  }, [setCurrentUser]);

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
    accessMode,
    offlineIdentity,
    refetch,
    resetForServerTransition,
  };
}
