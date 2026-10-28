import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { Logs } from "../../app/ui/src/pages/Logs";
import { Stack } from "../../app/ui/src/pages/Stack";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  completeOperationActions,
  operationOutcome,
  SampleEventSource,
  setOperationSample,
  subscribeOperationSample,
  type OperationSample,
} from "./admin-operations-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const [sample, setSample] = useState<OperationSample>("ready");
  const outcome = useSyncExternalStore(
    subscribeOperationSample,
    operationOutcome,
  );
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Páginas reales de Admin · datos ficticios. Las acciones son locales;
          completa la muestra para ver el estado ocupado.
        </p>
        <nav aria-label="Páginas de muestra" className="flex flex-wrap gap-3">
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/logs">Logs</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/stack">Stack</Link>
          </Button>
        </nav>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={sample}
            onValueChange={(value) => {
              setOperationSample(value);
              setSample(value);
            }}
            items={[
              { value: "ready", label: "Listo" },
              { value: "loading", label: "Cargando" },
              { value: "empty", label: "Vacío" },
              { value: "offline", label: "Sin servicio" },
            ]}
          />
        </div>
        <Button
          variant="outline"
          className="min-h-11 justify-self-start"
          onClick={completeOperationActions}
        >
          Completar acción de muestra
        </Button>
        <output
          aria-label="Última acción de muestra"
          className="font-mono text-xs break-all"
        >
          {outcome}
        </output>
      </header>
      <section key={sample} aria-label="Página real de Admin">
        <Routes>
          <Route path="/logs" element={<Logs />} />
          <Route path="/stack" element={<Stack />} />
          <Route
            path="/tasks"
            element={
              <p>
                Destino ficticio de tarea. <Link to="/logs">Volver a Logs</Link>
              </p>
            }
          />
        </Routes>
      </section>
      <Toaster {...toasterConfig} />
    </main>
  );
}
// Only this isolated preview entry replaces EventSource; production apps keep their streams.
Object.defineProperty(window, "EventSource", {
  configurable: true,
  value: SampleEventSource,
});
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() =>
  createRoot(document.getElementById("root")!).render(
    <MemoryRouter
      initialEntries={[
        new URLSearchParams(location.search).get("page") === "stack"
          ? "/stack"
          : "/logs",
      ]}
    >
      <Demo />
    </MemoryRouter>,
  ),
);
