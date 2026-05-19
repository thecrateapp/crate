import { useLocation, Navigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(redirect)}`}
        replace
      />
    );
  }
  if (!canAccessAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-lg font-medium">Admin console access required</p>
        <p className="text-sm text-muted-foreground">
          Your account ({user.email}) does not have a console role.
        </p>
        <button
          onClick={() => (window.location.href = "/login")}
          className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-white"
        >
          Switch account
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

export function CapabilityRoute({
  anyOf,
  children,
}: {
  anyOf: readonly string[];
  children: React.ReactNode;
}) {
  const { user, loading, hasAnyCapability } = useAuth();
  const location = useLocation();

  if (loading) return <PageSpinner />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(redirect)}`}
        replace
      />
    );
  }
  if (!hasAnyCapability(anyOf)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-semibold text-foreground">
          Permission required
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account ({user.email}) can enter the console, but cannot access
          this area.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
