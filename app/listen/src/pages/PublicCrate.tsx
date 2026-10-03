import { AuthSpinner } from "@/app-shell/AppFallbacks";
import { AppProviders } from "@/app-shell/AppProviders";
import { PublicAppProviders } from "@/app-shell/PublicAppProviders";
import { PublicShell } from "@/app-shell/PublicShell";
import { Shell } from "@/components/layout/Shell";
import { ShareSheetHost } from "@/components/share/ShareSheet";
import { useAuth } from "@/contexts/AuthContext";
import { Crate } from "@/pages/Crate";

export function PublicCrate() {
  const { user, loading } = useAuth();

  if (user) {
    return (
      <AppProviders>
        <Shell>
          <Crate />
        </Shell>
        <ShareSheetHost />
      </AppProviders>
    );
  }

  if (loading) return <AuthSpinner />;

  return (
    <PublicAppProviders>
      <PublicShell>
        <Crate />
      </PublicShell>
      <ShareSheetHost />
    </PublicAppProviders>
  );
}
