import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Analysis } from "../../app/ui/src/pages/Analysis";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  analysisSampleState,
  completeAnalysisActions,
  setAnalysisSample,
  subscribeAnalysisSample,
} from "./admin-analysis-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const { sample, outcome } = useSyncExternalStore(
    subscribeAnalysisSample,
    analysisSampleState,
  );
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · datos ficticios. Las acciones son locales;
          completa la muestra para ver el estado ocupado.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={sample}
            onValueChange={setAnalysisSample}
            items={[
              { value: "ready", label: "Listo" },
              { value: "loading", label: "Cargando" },
              { value: "empty", label: "Vacío" },
              { value: "fallback", label: "PCM fallback" },
              { value: "missing", label: "Sin estado" },
              { value: "offline", label: "Sin servicio" },
            ]}
          />
        </div>
        <Button
          variant="outline"
          className="min-h-11 justify-self-start"
          onClick={completeAnalysisActions}
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
        <Analysis />
      </section>
      <Toaster {...toasterConfig} />
    </main>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() => createRoot(document.getElementById("root")!).render(<Demo />));
