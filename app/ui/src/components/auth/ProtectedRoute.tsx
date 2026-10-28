import { useLocation, Navigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Button } from "@crate/ui/shadcn/button";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState variant="route" />;
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
      <ErrorState
        variant="page"
        kind="unavailable"
        title="Admin console access required"
        message={`Your account (${user.email}) does not have a console role.`}
        action={
          <Button
            shape="pill"
            onClick={() => (window.location.href = "/login")}
          >
            Switch account
          </Button>
        }
      />
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

  if (loading) return <LoadingState variant="route" />;
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
      <ErrorState
        variant="page"
        kind="unavailable"
        title="Permission required"
        message={`Your account (${user.email}) can enter the console, but cannot access this area.`}
        backTo="/"
        backLabel="Back to console"
      />
    );
  }

  return <>{children}</>;
}
