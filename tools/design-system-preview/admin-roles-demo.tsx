import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Roles } from "../../app/ui/src/pages/Roles";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import {
  subscribe,
  snapshot,
  setSample,
  completeRead,
} from "./admin-roles-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return (
    <div className="grid grid-cols-1 gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · roles y capacidades de muestra. Catálogo de
          solo lectura: no modifica permisos ni consulta un backend. La lectura
          pendiente se completa manualmente.
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
              {
                value: "null",
                label: "Sin payload",
                disabled: state.pending > 0,
              },
            ]}
          />
        </div>
        <div>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={!state.pending}
            onClick={completeRead}
          >
            Completar lectura de muestra
          </Button>
        </div>
        <p className="font-mono text-xs" role="status">
          {state.pending} lecturas pendientes de muestra
        </p>
      </header>
      <section aria-label="Página real de Roles">
        <Roles key={state.sample} />
      </section>
    </div>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
