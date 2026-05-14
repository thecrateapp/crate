import { AppErrorBoundary } from "@/app-shell/AppErrorBoundary";
import { AppRouter } from "@/app-shell/AppRouter";
import { TauriDevLogPanel } from "@/components/dev/TauriDevLogPanel";
import { AuthProvider } from "@/contexts/AuthContext";

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppRouter />
        <TauriDevLogPanel />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
