import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router";
import { SystemHealth } from "../../app/ui/src/pages/SystemHealth";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import {
  setSystemSample,
  subscribeSystemSample,
  systemSampleState,
} from "./admin-system-health-fixtures";
import "./admin-navigation-demo.css";

function Demo() {
  const state = useSyncExternalStore(subscribeSystemSample, systemSampleState);
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · métricas ficticias. La ventana y la
          actualización son locales, sin backend.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Muestra de métricas</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Muestra de métricas"
            value={state.sample}
            onValueChange={setSystemSample}
            items={[
              { value: "ready", label: "Actividad" },
              { value: "pressure", label: "Presión" },
            ]}
          />
        </div>
        <output
          aria-label="Consulta de muestra"
          className="font-mono text-label font-normal break-all"
        >
          {state.url}
        </output>
        <output
          aria-label="Actualizaciones de muestra"
          className="font-mono text-label font-normal"
        >
          Actualizaciones locales: {state.refreshCount}
        </output>
      </header>
      <section aria-label="Página real de Admin">
        <SystemHealth />
      </section>
    </main>
  );
}
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
