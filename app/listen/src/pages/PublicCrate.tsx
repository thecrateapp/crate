import { AppProviders } from "@/app-shell/AppProviders";
import { ShareSheetHost } from "@/components/share/ShareSheet";
import { Crate } from "@/pages/Crate";

export function PublicCrate() {
  return (
    <AppProviders>
      <main className="min-h-screen bg-surface-canvas px-4 py-8 text-text-primary sm:px-8">
        <Crate />
      </main>
      <ShareSheetHost />
    </AppProviders>
  );
}
