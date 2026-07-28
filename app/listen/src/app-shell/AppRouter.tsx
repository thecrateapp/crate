import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import { ProtectedRoute, ServerGate } from "@/app-shell/RouteGuards";
import {
  protectedAppRoutes,
  publicAppRoutes,
  type AppRouteDefinition,
} from "@/app-shell/route-table";
import { TranslationOverlay } from "@/i18n/translation-mode/TranslationOverlay";

const AuthenticatedApp = lazy(() =>
  import("@/app-shell/AuthenticatedApp").then((module) => ({
    default: module.AuthenticatedApp,
  })),
);

function renderRoute(route: AppRouteDefinition) {
  if (route.index) {
    return <Route key="index" index element={route.element} />;
  }
  return <Route key={route.path} path={route.path} element={route.element} />;
}

export function AppRouter() {
  return (
    <ServerGate>
      <Routes>
        {publicAppRoutes.map(renderRoute)}
        <Route
          element={
            <ProtectedRoute>
              <Suspense fallback={null}>
                <AuthenticatedApp />
              </Suspense>
            </ProtectedRoute>
          }
        >
          {protectedAppRoutes.map(renderRoute)}
        </Route>
      </Routes>
      <TranslationOverlay />
    </ServerGate>
  );
}
