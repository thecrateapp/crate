import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Trash } from "../../app/ui/src/pages/Trash";
import { Button } from "@crate/ui/shadcn/button";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  completeTrashTask,
  setTrashFailure,
  setTrashSample,
  subscribeTrashSample,
  trashSampleState,
} from "./admin-trash-fixtures";
import "./admin-navigation-demo.css";

function Demo() {
  const state = useSyncExternalStore(subscribeTrashSample, trashSampleState);
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · pistas ficticias. Restaurar, eliminar y vaciar
          solo afectan a esta muestra; no modifican archivos reales.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={state.sample}
            onValueChange={setTrashSample}
            items={[
              {
                value: "ready",
                label: "Con pistas",
                disabled: Boolean(state.pending),
              },
              {
                value: "loading",
                label: "Cargando",
                disabled: Boolean(state.pending),
              },
              {
                value: "empty",
                label: "Vacía",
                disabled: Boolean(state.pending),
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            className="min-h-11"
            variant="outline"
            disabled={!state.pending}
            onClick={completeTrashTask}
          >
            Completar tarea de muestra
          </Button>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.failNext}
              disabled={Boolean(state.pending)}
              onChange={(event) => setTrashFailure(event.target.checked)}
            />
            La siguiente tarea fallará
          </label>
        </div>
        <p
          role="status"
          aria-label="Última acción de muestra"
          className="break-all font-mono text-label"
        >
          {state.action}
        </p>
      </header>
      <section aria-label="Página real de Admin">
        <Trash key={state.sample} />
      </section>
      <Toaster {...toasterConfig} />
    </main>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() => createRoot(document.getElementById("root")!).render(<Demo />));
