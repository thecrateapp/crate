import { lazy, Suspense } from "react";
import { matchPath, useLocation } from "react-router";

import { AuthSpinner } from "@/app-shell/AppFallbacks";
import { ProtectedRoute } from "@/app-shell/RouteGuards";
import { useAuth } from "@/contexts/AuthContext";

const AuthenticatedApp = lazy(() =>
  import("@/app-shell/AuthenticatedApp").then((module) => ({
    default: module.AuthenticatedApp,
  })),
);

const PublicAppLayout = lazy(() =>
  import("@/app-shell/PublicAppLayout").then((module) => ({
    default: module.PublicAppLayout,
  })),
);

export const ANONYMOUS_APP_ROUTE_PATTERNS = ["/crate/:crateRef"];

function allowsAnonymous(pathname: string): boolean {
  return ANONYMOUS_APP_ROUTE_PATTERNS.some((pattern) =>
    matchPath(pattern, pathname),
  );
}

export function AppLayoutRoute() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (!user && allowsAnonymous(pathname)) {
    if (loading) return <AuthSpinner />;
    return (
      <Suspense fallback={<AuthSpinner />}>
        <PublicAppLayout />
      </Suspense>
    );
  }

  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <AuthenticatedApp />
      </Suspense>
    </ProtectedRoute>
  );
}
