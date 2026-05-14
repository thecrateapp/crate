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
  const { user, loading, isAdmin } = useAuth();
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
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-lg font-medium">Admin access required</p>
        <p className="text-sm text-muted-foreground">
          Your account ({user.email}) does not have admin privileges.
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
