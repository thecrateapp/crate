import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Routes, Route, useLocation } from "react-router";
import { Playlists } from "../../app/ui/src/pages/Playlists";
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
  setFailure,
  complete,
} from "./admin-playlists-fixtures";
import "./admin-navigation-demo.css";
import { RowInteractionSample } from "./row-interaction-sample";
function Destination() {
  const location = useLocation();
  return (
    <section className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p>
        La ruta del editor se conserva. Su contenido se revisará en el siguiente
        grupo.
      </p>
      <p className="break-all font-mono">{location.pathname}</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/admin-playlists-demo.html"
      >
        Volver a playlists de muestra
      </Link>
    </section>
  );
}
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return (
    <BrowserRouter>
      <main className="grid min-w-0 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            System Playlists real de Admin · datos e imágenes ficticios.
            Lecturas y acciones locales; no necesita backend ni modifica tu
            biblioteca. Las portadas conservan su imagen, degradado y marca de
            Crate.
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
          <div className="flex flex-wrap items-center gap-4">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!state.pending}
              onClick={complete}
            >
              Completar acción o lectura de muestra
            </Button>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={state.failNext}
                disabled={!!state.pending}
                onChange={(e) => setFailure(e.target.checked)}
              />
              Fallar la siguiente acción
            </label>
          </div>
          <p role="status" className="break-all font-mono text-xs">
            {state.action}
          </p>
        </header>
        <Routes>
          <Route
            path="/admin-playlists-demo.html"
            element={
              <section aria-label="Página real de System Playlists">
                <Playlists key={state.sample} />
              </section>
            }
          />
          <Route path="*" element={<Destination />} />
        </Routes>
        <RowInteractionSample />
        <Toaster {...toasterConfig} />
      </main>
    </BrowserRouter>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
