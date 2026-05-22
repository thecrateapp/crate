import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  avatar?: string;
  username?: string | null;
  bio?: string | null;
  capabilities?: string[];
  connected_accounts?: Array<{ provider: string; status: string }>;
}

export const ADMIN_CONSOLE_ENTRY_CAPABILITIES = [
  "ops.health.view",
  "ops.logs.view",
  "ops.tasks.manage",
  "ops.runtime.manage",
  "settings.manage",
  "auth.manage",
  "audit.view",
  "users.view",
  "roles.view",
  "library.metadata.write",
  "library.analysis.manage",
  "library.track.remove",
  "library.album.remove",
  "library.artist.remove",
  "library.files.delete",
  "library.repair.run",
  "library.import.manage",
  "library.bandcamp.manage",
  "library.tidal.manage",
  "curation.playlists.write",
  "curation.genres.write",
  "curation.shows.write",
  "curation.releases.write",
] as const;

function hasLegacyAdminRole(user: AuthUser | null): boolean {
  return user?.role === "admin" || user?.role === "owner";
}

export function userHasCapability(
  user: AuthUser | null,
  capability: string,
): boolean {
  if (!user) return false;
  if (hasLegacyAdminRole(user)) return true;
  return Boolean(user.capabilities?.includes(capability));
}

export function userHasAnyCapability(
  user: AuthUser | null,
  capabilities: readonly string[],
): boolean {
  return capabilities.some((capability) => userHasCapability(user, capability));
}

export function userCanAccessAdminConsole(user: AuthUser | null): boolean {
  return (
    userHasCapability(user, "admin.access") ||
    userHasAnyCapability(user, ADMIN_CONSOLE_ENTRY_CAPABILITIES)
  );
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  hasCapability: (capability: string) => boolean;
  hasAnyCapability: (capabilities: readonly string[]) => boolean;
  refetch: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const lastHeartbeatAtRef = useRef(0);

  const fetchUser = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/api/auth/me");
      if (data && data.id) setUser(data);
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (!user) return;
    async function sendHeartbeat(force = false) {
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastHeartbeatAtRef.current < 55_000) return;
      lastHeartbeatAtRef.current = now;
      await api("/api/auth/heartbeat", "POST", { app_id: "admin-web" }).catch(
        () => {},
      );
    }

    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 60_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sendHeartbeat(true);
      }
    }

    function handleOnline() {
      void sendHeartbeat(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore
    }
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        isAdmin: userHasCapability(user, "admin.access"),
        canAccessAdmin: userCanAccessAdminConsole(user),
        hasCapability: (capability) => userHasCapability(user, capability),
        hasAnyCapability: (capabilities) =>
          userHasAnyCapability(user, capabilities),
        refetch: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
