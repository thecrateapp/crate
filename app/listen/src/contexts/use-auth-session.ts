import { useCallback, useEffect, useRef, useState } from "react";

import { type AuthUser } from "@/contexts/auth-context";
import { applyAuthenticatedUser } from "@/contexts/auth-runtime";
import { api } from "@/lib/api";
import { ApiError } from "../../../shared/web/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const userRef = useRef<AuthUser | null>(null);
  const authRequestRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const setCurrentUser = useCallback((nextUser: AuthUser | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  }, []);

  const refetch = useCallback(async (): Promise<AuthUser | null> => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    authRequestRef.current?.abort();
    const controller = new AbortController();
    authRequestRef.current = controller;
    setLoading(true);

    try {
      const data = await api<AuthUser>("/api/auth/me", "GET", undefined, {
        signal: controller.signal,
      });
      const nextUser = data && data.id ? data : null;
      setCurrentUser(nextUser);
      setSessionUnavailable(false);
      applyAuthenticatedUser(nextUser);
      return nextUser;
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return userRef.current;
      }
      const isRejectedSession =
        error instanceof ApiError && [401, 403].includes(error.status);
      if (isRejectedSession) {
        setCurrentUser(null);
        setSessionUnavailable(false);
        applyAuthenticatedUser(null);
        return null;
      }
      setSessionUnavailable(true);
      if (userRef.current || getStoredAuthUserId()) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void refetch();
        }, 1500);
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

  useEffect(() => {
    void refetch();
    return () => {
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
    setUser: setCurrentUser,
  };
}
