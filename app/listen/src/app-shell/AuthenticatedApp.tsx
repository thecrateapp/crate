import { AppProviders } from "@/app-shell/AppProviders";
import { TauriDevLogPanel } from "@/components/dev/TauriDevLogPanel";
import { Shell } from "@/components/layout/Shell";
import { ShareSheetHost } from "@/components/share/ShareSheet";
import { useMediaAccessVersion } from "@/hooks/use-media-access-version";

export function AuthenticatedApp() {
  useMediaAccessVersion();

  return (
    <AppProviders>
      <Shell />
      <ShareSheetHost />
      <TauriDevLogPanel />
    </AppProviders>
  );
}
