import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
import { AppRouter } from "@/app-shell/AppRouter";
import { AuthProvider } from "@/contexts/AuthContext";

export function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
