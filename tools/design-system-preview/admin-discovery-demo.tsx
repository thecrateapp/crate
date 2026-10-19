import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router";
import { Discover } from "../../app/ui/src/pages/Discover";
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
  setOutcome,
  setFailure,
  advance,
  sampleArt,
} from "./admin-discovery-fixtures";
import "./admin-navigation-demo.css";
function Destination() {
  const location = useLocation();
  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p>
        El control real conserva su ruta. La muestra no abre la página de
        destino ni consulta su backend.
      </p>
      <p className="break-all font-mono text-sm">
        {location.pathname}
        {location.search}
      </p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/admin-discovery-demo.html"
      >
        Volver a Discovery de muestra
      </Link>
    </div>
  );
}
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return (
    <BrowserRouter>
      <div className="grid grid-cols-1 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            Página real de Admin · artistas, lanzamientos, imágenes y tareas
            ficticios. No ejecuta trabajos ni consulta una biblioteca. Los
            destinos son locales y están señalados.
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
            <MonoLabel as="span">Resultado de tarea</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Resultado de tarea"
              value={state.outcome}
              onValueChange={setOutcome}
              items={[
                { value: "complete", label: "Completa" },
                { value: "partial", label: "Parcial" },
                { value: "skipped", label: "Sin caché" },
                { value: "failed", label: "Fallida" },
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
            <FormField layout="inline" label="Fallar el siguiente envío">
              <Checkbox
                checked={state.failNext}
                onCheckedChange={(checked) => setFailure(checked === true)}
              />
            </FormField>
          </div>
          <p className="break-all font-mono text-xs" role="status">
            {state.action} · {state.pending} pasos pendientes
          </p>
        </header>
        <section aria-label="Página real de Discovery">
          <Routes>
            <Route
              path="/admin-discovery-demo.html"
              element={<Discover key={state.sample} />}
            />
            <Route path="*" element={<Destination />} />
          </Routes>
        </section>
        <Toaster {...toasterConfig} />
      </div>
    </BrowserRouter>
  );
}
const sampleWindow = window as Window & {
  __crateResolveApiAssetUrl?: (path: string) => string;
};
const previousResolver = sampleWindow.__crateResolveApiAssetUrl;
sampleWindow.__crateResolveApiAssetUrl = (path) => {
  if (/^\/api\/artists\/23\/photo(?:\?|$)/.test(path)) return sampleArt;
  if (/^\/api\/artists\/24\/photo(?:\?|$)/.test(path))
    return "data:image/png;base64,AA==";
  return previousResolver ? previousResolver(path) : path;
};
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    sampleWindow.__crateResolveApiAssetUrl = previousResolver;
  });
flushSync(() => createRoot(document.getElementById("root")!).render(<Demo />));
