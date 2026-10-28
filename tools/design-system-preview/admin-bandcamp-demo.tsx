import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Bandcamp } from "../../app/ui/src/pages/Bandcamp";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
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
} from "./admin-bandcamp-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const destination = new URLSearchParams(window.location.search).get(
    "destino",
  );
  if (destination)
    return (
      <main className="grid gap-4 p-6">
        <h1 className="font-display text-3xl">Destino externo de muestra</h1>
        <p>
          El botón real abre una nueva ventana. Esta muestra conserva el destino
          original como texto y evita navegar a un servicio externo.
        </p>
        <p className="break-all font-mono text-sm">{destination}</p>
        <a
          className="inline-flex min-h-11 items-center underline"
          href="./admin-bandcamp-demo.html"
        >
          Volver a Bandcamp de muestra
        </a>
      </main>
    );
  return (
    <div className="grid grid-cols-1 gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · conexión, compras, correspondencias y tareas
          ficticias. No se consulta Bandcamp ni se modifica una biblioteca. Los
          enlaces externos abren destinos locales señalados.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={state.sample}
            onValueChange={setSample}
            items={[
              { value: "ready", label: "Conectado", disabled: state.pending },
              {
                value: "disconnected",
                label: "Sin conexión",
                disabled: state.pending,
              },
              { value: "empty", label: "Vacío", disabled: state.pending },
              {
                value: "checking",
                label: "Comprobando",
                disabled: state.pending,
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
              disabled={state.pending}
              onCheckedChange={(checked) => setFailure(checked === true)}
            />
          </FormField>
        </div>
        <p className="break-all font-mono text-xs" role="status">
          {state.action}
        </p>
      </header>
      <section aria-label="Página real de Bandcamp">
        <Bandcamp key={state.sample} />
      </section>
      <Toaster {...toasterConfig} />
    </div>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() => createRoot(document.getElementById("root")!).render(<Demo />));
