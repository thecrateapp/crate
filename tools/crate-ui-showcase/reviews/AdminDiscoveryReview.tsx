import { useEffect, useRef, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { Discover } from "../../../app/ui/src/pages/Discover";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  setSample,
  snapshot,
  subscribe,
  type Sample,
} from "../../design-system-preview/admin-discovery-fixtures";

export function AdminDiscoveryReview({
  initialSample = "ready",
}: {
  initialSample?: Sample;
}) {
  const state = useSyncExternalStore(subscribe, snapshot);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (state.sample !== initialSample) setSample(initialSample);
  }, [initialSample, state.sample]);

  return (
    <MemoryRouter initialEntries={["/discover"]}>
      <main className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
        <header className="grid gap-3 border-b border-border-quiet pb-5">
          <p className="text-sm text-text-muted">
            Página real de Admin · datos ficticios. Prueba la pérdida de una
            fuente sin ocultar los feeds que siguen disponibles.
          </p>
          <div className="crate-form-field">
            <MonoLabel as="span">Estado de muestra</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Estado de muestra"
              value={state.sample}
              onValueChange={setSample}
              items={[
                { value: "ready", label: "Con datos" },
                { value: "loading", label: "Cargando" },
                { value: "empty", label: "Vacío" },
                { value: "partial-error", label: "Fallo parcial" },
                { value: "error", label: "Error total" },
              ]}
            />
          </div>
        </header>
        <section aria-label="Página real de Admin" className="min-w-0">
          <Discover key={state.sample} />
        </section>
        <Toaster {...toasterConfig} />
      </main>
    </MemoryRouter>
  );
}
