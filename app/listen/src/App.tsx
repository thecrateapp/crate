import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
import { AppRouter } from "@/app-shell/AppRouter";
import { TauriDevLogPanel } from "@/components/dev/TauriDevLogPanel";
import { ShareSheetHost } from "@/components/share/ShareSheet";
import { AuthProvider } from "@/contexts/AuthContext";

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppRouter />
        <ShareSheetHost />
        <TauriDevLogPanel />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
