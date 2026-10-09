import { Route, Routes } from "react-router";

import { AppLayoutRoute } from "@/app-shell/AppLayoutRoute";
import { ServerGate } from "@/app-shell/RouteGuards";
import {
  protectedAppRoutes,
  publicAppRoutes,
  type AppRouteDefinition,
} from "@/app-shell/route-table";
import { TranslationOverlay } from "@/i18n/translation-mode/TranslationOverlay";

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
        <Route element={<AppLayoutRoute />}>
          {protectedAppRoutes.map(renderRoute)}
        </Route>
      </Routes>
      <TranslationOverlay />
    </ServerGate>
  );
}
