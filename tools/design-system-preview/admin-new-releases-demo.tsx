import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router";
import { NewReleases } from "../../app/ui/src/pages/NewReleases";
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
  setOutcome,
  setFailure,
  advance,
  pushStream,
  SampleEventSource,
} from "./admin-new-releases-fixtures";
import "./admin-navigation-demo.css";
function Destination() {
  const l = useLocation();
  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p>
        El enlace real conserva su ruta. La muestra no consulta la página de
        destino.
      </p>
      <p className="break-all font-mono text-sm">
        {l.pathname}
        {l.search}
      </p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/admin-new-releases-demo.html"
      >
        Volver a New Releases de muestra
      </Link>
    </div>
  );
}
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const caps =
    state.access === "curate"
      ? ["curation.releases.write"]
      : state.access === "acquire"
        ? ["library.tidal.manage"]
        : [];
  const auth: AuthContextValue = {
    user: {
      id: 1,
      name: "Muestra",
      email: "sample@example.invalid",
      role: "sample",
      capabilities: caps,
    },
    loading: false,
    isAdmin: false,
    canAccessAdmin: true,
    logout: () => {},
    refetch: () => {},
    hasCapability: (cap) => caps.includes(cap),
    hasAnyCapability: (needed) => needed.some((cap) => caps.includes(cap)),
  };
  return (
    <BrowserRouter>
      <div className="grid grid-cols-1 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            Página real de Admin · lanzamientos, portadas, permisos y tareas
            ficticios. Sin backend ni trabajos reales. Los destinos son locales;
            cada envío y tarea se completa por separado.
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
                  disabled: state.pending > 0,
                },
                {
                  value: "loading",
                  label: "Cargando",
                  disabled: state.pending > 0,
                },
                { value: "empty", label: "Vacío", disabled: state.pending > 0 },
                { value: "error", label: "Error", disabled: state.pending > 0 },
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
                { value: "curate", label: "Curar" },
                { value: "acquire", label: "Adquirir" },
                { value: "read", label: "Solo lectura" },
              ]}
            />
          </div>
          <div className="crate-form-field">
            <MonoLabel as="span">Resultado del chequeo</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Resultado del chequeo"
              value={state.outcome}
              onValueChange={setOutcome}
              items={[
                { value: "completed", label: "Completo" },
                { value: "failed", label: "Fallido" },
                { value: "reject", label: "Error de espera" },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!state.pending}
              onClick={advance}
            >
              Completar siguiente paso de muestra
            </Button>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={state.failNext}
                onChange={(event) => setFailure(event.target.checked)}
              />
              Fallar el siguiente envío
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={state.pending > 0 || state.sample !== "ready"}
              onClick={() => pushStream()}
            >
              Enviar actualización SSE de muestra
            </Button>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={state.pending > 0 || state.sample !== "ready"}
              onClick={() => pushStream(true)}
            >
              Enviar SSE no válido
            </Button>
          </div>
          <p className="break-all font-mono text-xs" role="status">
            {state.action} · {state.pending} pasos pendientes
          </p>
        </header>
        <AuthContext.Provider value={auth}>
          <section aria-label="Página real de New Releases">
            <Routes>
              <Route
                path="/admin-new-releases-demo.html"
                element={<NewReleases key={state.sample} />}
              />
              <Route path="*" element={<Destination />} />
            </Routes>
          </section>
        </AuthContext.Provider>
        <Toaster {...toasterConfig} />
      </div>
    </BrowserRouter>
  );
}
const previousEventSource = window.EventSource;
window.EventSource = SampleEventSource as unknown as typeof EventSource;
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    window.EventSource = previousEventSource;
  });
createRoot(document.getElementById("root")!).render(<Demo />);
