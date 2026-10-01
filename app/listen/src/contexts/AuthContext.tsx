import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { api, revokeServerSession, setAuthToken } from "@/lib/api";
import { AuthContext } from "@/contexts/auth-context";
import { clearAuthRuntime } from "@/contexts/auth-runtime";
import { revokeOfflineIdentityForServer } from "@/lib/offline-identity";
import { usesConfigurableServer } from "@/lib/platform";
import {
  getCurrentServer,
  getCurrentServerId,
  SERVER_STORE_EVENT,
} from "@/lib/server-store";
import { useAuthHeartbeat } from "@/contexts/use-auth-heartbeat";
import { useAuthOAuthSync } from "@/contexts/use-auth-oauth-sync";
import { useAuthSession } from "@/contexts/use-auth-session";
import { useAuthTokenRefresh } from "@/contexts/use-auth-token-refresh";
import { useListenWarmup } from "@/hooks/use-listen-warmup";
import { setSentryUser } from "@/lib/sentry";

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const {
    user,
    loading,
    sessionUnavailable,
    accessMode,
    offlineIdentity,
    refetch,
    resetForServerTransition,
  } = useAuthSession();
  const currentServerIdRef = useRef<{ value: string | null } | null>(null);
  if (currentServerIdRef.current === null) {
    currentServerIdRef.current = { value: getCurrentServerId() };
  }
  const currentServerId = currentServerIdRef.current;

  useEffect(() => {
    const handleServerChange = () => {
      const nextServerId = getCurrentServerId();
      if (nextServerId === currentServerId.value) return;
      currentServerId.value = nextServerId;

      const nextServer = getCurrentServer();
      clearAuthRuntime({
        clearStoredUser: false,
        reason: "user-change",
      });
      resetForServerTransition(Boolean(nextServerId && nextServer?.token));

      if (!nextServerId) return;
      if (nextServer?.token) {
        void refetch();
      } else {
        navigate("/login", { replace: true });
      }
    };

    window.addEventListener(SERVER_STORE_EVENT, handleServerChange);
    return () =>
      window.removeEventListener(SERVER_STORE_EVENT, handleServerChange);
  }, [navigate, refetch, resetForServerTransition]);

  useEffect(() => {
    setSentryUser(user?.id ?? null);
  }, [user?.id]);

  useAuthOAuthSync({ navigate, refetch });
  useAuthTokenRefresh(user);
  useAuthHeartbeat(user);
  useListenWarmup(user);

  useEffect(() => {
    if (accessMode !== "offline") return;
    const revalidate = () => void refetch();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("online", revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", revalidate);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [accessMode, refetch]);

  const logout = useCallback(async () => {
    const server = getCurrentServer();
    revokeOfflineIdentityForServer(getCurrentServerId() ?? "web");
    const revocation = usesConfigurableServer
      ? server
        ? revokeServerSession(server)
        : Promise.resolve()
      : api("/api/auth/logout", "POST").then(() => undefined);
    clearAuthRuntime({ reason: "logout" });
    setAuthToken(null);
    resetForServerTransition(false);
    navigate("/login");
    void revocation.catch(() => {
      // Local logout must complete even if the server cannot be reached.
    });
  }, [navigate, resetForServerTransition]);

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionUnavailable,
      accessMode,
      offlineIdentity,
      refetch,
      logout,
    }),
    [
      user,
      loading,
      sessionUnavailable,
      accessMode,
      offlineIdentity,
      refetch,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
