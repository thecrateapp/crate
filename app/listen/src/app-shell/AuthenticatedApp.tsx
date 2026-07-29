import { AppProviders } from "@/app-shell/AppProviders";
import { TauriDevLogPanel } from "@/components/dev/TauriDevLogPanel";
import { Shell } from "@/components/layout/Shell";
import { ShareSheetHost } from "@/components/share/ShareSheet";

export function AuthenticatedApp() {
  return (
    <AppProviders>
      <Shell />
      <ShareSheetHost />
      <TauriDevLogPanel />
    </AppProviders>
  );
}
