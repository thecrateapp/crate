import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Routes, Route, useLocation } from "react-router";
import { Upcoming } from "../../app/ui/src/pages/Upcoming";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  subscribe,
  snapshot,
  setSample,
  setAccess,
  setFailure,
  complete,
} from "./admin-upcoming-fixtures";
import "./admin-navigation-demo.css";
function Destination() {
  const l = useLocation();
  return (
    <section className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p>El enlace conserva su ruta; esta muestra no consulta el destino.</p>
      <p className="break-all font-mono">
        {l.pathname}
        {l.search}
      </p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/admin-upcoming-demo.html"
      >
        Volver a Upcoming de muestra
      </Link>
    </section>
  );
}
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const caps =
    state.access === "admin"
      ? [
          "admin.access",
          "curation.shows.write",
          "curation.releases.write",
          "library.tidal.manage",
        ]
      : state.access === "shows"
        ? ["curation.shows.write"]
        : ["library.tidal.manage"];
  const user = {
    id: 999,
    email: "sample@example.invalid",
    name: "Muestra",
    role: "sample",
    capabilities: caps,
  };
  const auth: AuthContextValue = {
    user,
    actualUser: user,
    loading: false,
    isAdmin: state.access === "admin",
    canAccessAdmin: true,
    logout: () => {},
    refetch: () => {},
    hasCapability: (cap) => caps.includes(cap),
    hasAnyCapability: (needed) => needed.some((cap) => caps.includes(cap)),
    rolePresets: [],
    previewRole: null,
    setPreviewRole: () => {},
    clearRolePreview: () => {},
  };
  const destination = new URLSearchParams(window.location.search).get(
    "destino",
  );
  if (destination)
    return (
      <main className="grid gap-4 p-6">
        <h1 className="font-display text-3xl">Entradas de muestra</h1>
        <p>Este destino es local y no contacta al proveedor real.</p>
        <p className="break-all font-mono">{destination}</p>
        <a
          className="inline-flex min-h-11 items-center underline"
          href="./admin-upcoming-demo.html"
        >
          Volver a Upcoming de muestra
        </a>
      </main>
    );
  return (
    <BrowserRouter>
      <AuthContext.Provider value={auth}>
        <main className="grid min-w-0 gap-6 p-4 sm:p-6">
          <header className="grid gap-4 border-b border-border-quiet pb-6">
            <p className="text-sm text-text-muted">
              Upcoming y tarjetas reales de Admin · datos, imágenes, permisos y
              tareas ficticios. Sin backend ni destinos externos. El refresco de
              conciertos conserva la espera real de 10 segundos después de
              completar el envío de muestra.
            </p>
            <div className="crate-form-field">
              <MonoLabel as="span">Estado de muestra</MonoLabel>
              <SegmentedControl
                as="radio"
                label="Estado de muestra"
                value={state.sample}
                onValueChange={setSample}
                items={[
                  {
                    value: "ready",
                    label: "Con datos",
                    disabled: !!state.pending,
                  },
                  {
                    value: "loading",
                    label: "Cargando",
                    disabled: !!state.pending,
                  },
                  { value: "empty", label: "Vacío", disabled: !!state.pending },
                ]}
              />
            </div>
            <div className="crate-form-field">
              <MonoLabel as="span">Permisos de muestra</MonoLabel>
              <SegmentedControl
                as="radio"
                label="Permisos de muestra"
                value={state.access}
                onValueChange={setAccess}
                items={[
                  { value: "admin", label: "Admin", disabled: !!state.pending },
                  {
                    value: "acquire",
                    label: "Adquisición",
                    disabled: !!state.pending,
                  },
                  {
                    value: "shows",
                    label: "Conciertos",
                    disabled: !!state.pending,
                  },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                className="min-h-11"
                variant="outline"
                disabled={!state.pending}
                onClick={complete}
              >
                Completar acción o lectura de muestra
              </Button>
              <FormField layout="inline" label="Fallar la siguiente acción">
                <Checkbox
                  checked={state.failNext}
                  disabled={!!state.pending}
                  onCheckedChange={(checked) => setFailure(checked === true)}
                />
              </FormField>
            </div>
            <p role="status" className="break-all font-mono text-xs">
              {state.action}
            </p>
          </header>
          <Routes>
            <Route
              path="/admin-upcoming-demo.html"
              element={
                <section aria-label="Página real de Upcoming">
                  <Upcoming key={state.sample} />
                </section>
              }
            />
            <Route path="*" element={<Destination />} />
          </Routes>
          <Toaster {...toasterConfig} />
        </main>
      </AuthContext.Provider>
    </BrowserRouter>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
