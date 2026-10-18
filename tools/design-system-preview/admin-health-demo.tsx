import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter, Routes, Route, Link } from "react-router";
import { Health } from "../../app/ui/src/pages/Health";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
import { Button } from "@crate/ui/shadcn/button";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  completeHealthTask,
  healthSampleState,
  HealthSampleEventSource,
  setHealthSample,
  subscribeHealthSample,
} from "./admin-health-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribeHealthSample, healthSampleState);
  const [isAdmin, setAdmin] = useState(true);
  const user = {
    id: 1,
    name: "Muestra",
    email: "sample@example.test",
    role: isAdmin ? "admin" : "curator",
    roles: [isAdmin ? "admin" : "curator"],
  };
  const auth: AuthContextValue = {
    user,
    actualUser: user,
    loading: false,
    isAdmin,
    canAccessAdmin: true,
    hasCapability: () => true,
    hasAnyCapability: () => true,
    logout: () => {},
    refetch: () => {},
    rolePresets: [],
    previewRole: null,
    setPreviewRole: () => {},
    clearRolePreview: () => {},
  };
  return (
    <AuthContext.Provider value={auth}>
      <main className="grid min-w-0 grid-cols-1 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            Página real de Admin · datos ficticios. Reparaciones, acciones y
            tareas son locales; no modifican una biblioteca.
          </p>
          <div className="crate-form-field">
            <MonoLabel as="span">Estado de muestra</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Estado de muestra"
              value={state.sample}
              onValueChange={setHealthSample}
              items={[
                { value: "ready", label: "Con incidencias" },
                { value: "loading", label: "Cargando" },
                { value: "empty", label: "Vacío" },
                { value: "unknown", label: "Sin resultado" },
                { value: "stale", label: "Desactualizado" },
                { value: "limited", label: "Lista limitada" },
                { value: "mixed", label: "Severidades mixtas" },
                { value: "partial", label: "Sin catálogo" },
                { value: "offline", label: "Sin servicio" },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setAdmin(e.target.checked)}
              />
              Permitir escaneo de muestra
            </label>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={completeHealthTask}
            >
              Completar tarea de muestra
            </Button>
          </div>
          <output
            aria-label="Última acción de muestra"
            className="font-mono text-label font-normal break-all"
          >
            {state.outcome}
          </output>
        </header>
        <section
          key={state.generation}
          aria-label="Página real de Admin"
          className="min-w-0"
        >
          <Routes>
            <Route path="/" element={<Health />} />
            <Route
              path="*"
              element={
                <p>
                  Destino ficticio.{" "}
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    to="/"
                  >
                    Volver a Library Health
                  </Link>
                </p>
              }
            />
          </Routes>
        </section>
        <Toaster {...toasterConfig} />
      </main>
    </AuthContext.Provider>
  );
}
Object.defineProperty(window, "EventSource", {
  configurable: true,
  value: HealthSampleEventSource,
});
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() =>
  createRoot(document.getElementById("root")!).render(
    <MemoryRouter>
      <Demo />
    </MemoryRouter>,
  ),
);
