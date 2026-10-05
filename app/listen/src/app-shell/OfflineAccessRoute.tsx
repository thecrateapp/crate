import { Navigate } from "react-router";

import { AuthSpinner } from "@/app-shell/AppFallbacks";
import { OfflineProvider } from "@/contexts/OfflineContext";
import { useAuth } from "@/contexts/AuthContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { OfflineLibrary } from "@/pages/OfflineLibrary";

export function OfflineAccessRoute() {
  const { user, loading, accessMode, offlineIdentity } = useAuth();

  if (accessMode === "loading" || (loading && !user)) return <AuthSpinner />;
  if (user) return <Navigate to="/" replace />;
  if (accessMode !== "offline" || !offlineIdentity) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PlayerProvider>
      <OfflineProvider>
        <OfflineLibrary />
      </OfflineProvider>
    </PlayerProvider>
  );
}
