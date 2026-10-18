import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { I18nReview } from "../../app/ui/src/pages/I18nReview";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { Toaster } from "sonner";
import {
  subscribe,
  snapshot,
  setSample,
  setFailure,
  setWorkspace,
  complete,
  installCatalogSample,
} from "./admin-translations-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return (
    <main className="grid min-w-0 gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Translations real de Admin con datos ficticios. Las acciones, el
          catálogo JSON y la exportación son locales a esta muestra; no consulta
          Listen ni modifica traducciones reales.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={state.sample}
            onValueChange={setSample}
            items={[
              { value: "ready", label: "Con datos", disabled: !!state.pending },
              {
                value: "loading",
                label: "Cargando",
                disabled: !!state.pending,
              },
              { value: "empty", label: "Vacío", disabled: !!state.pending },
              { value: "no-ai", label: "Sin IA", disabled: !!state.pending },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            className="min-h-11"
            variant="outline"
            onClick={complete}
            disabled={!state.pending}
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
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={state.workspace}
              disabled={!!state.pending}
              onChange={(e) => setWorkspace(e.target.checked)}
            />
            Catálogo JSON de muestra disponible
          </label>
        </div>
        <p role="status" className="break-all font-mono text-xs">
          {state.action}
        </p>
      </header>
      <section aria-label="Página real de Translations">
        <I18nReview key={state.sample + String(state.workspace)} />
      </section>
      <Toaster {...toasterConfig} />
    </main>
  );
}
applyCrateIdentity();
const disposeFocus = installFocusRingMotion();
const disposeCatalog = installCatalogSample();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposeFocus();
    disposeCatalog();
  });
createRoot(document.getElementById("root")!).render(<Demo />);
