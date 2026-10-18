import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router";
import { Contributions } from "../../app/ui/src/pages/Contributions";
import { Button } from "@crate/ui/shadcn/button";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  completeContributionsRead,
  contributionsSampleState,
  setContributionsSample,
  subscribeContributionsSample,
} from "./admin-contributions-fixtures";
import "./admin-navigation-demo.css";

function Destination() {
  const location = useLocation();
  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p>
        El enlace real de Contributions lleva a este álbum. La muestra no carga
        la página de álbum ni consulta un servidor.
      </p>
      <p className="break-all font-mono text-sm">{location.pathname}</p>
      <Link
        className="inline-flex min-h-11 items-center text-accent-action-hi underline"
        to="/admin-contributions-demo.html"
        onClick={() =>
          setContributionsSample(contributionsSampleState().sample)
        }
      >
        Volver a Contributions de muestra
      </Link>
    </div>
  );
}
function Demo() {
  const state = useSyncExternalStore(
    subscribeContributionsSample,
    contributionsSampleState,
  );
  return (
    <BrowserRouter>
      <main className="grid grid-cols-1 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            Página real de Admin · aportes y usuarios ficticios. Las lecturas
            son locales; los enlaces conservan la ruta real del álbum y muestran
            un destino de muestra.
          </p>
          <div className="crate-form-field">
            <MonoLabel as="span">Estado de muestra</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Estado de muestra"
              value={state.sample}
              onValueChange={setContributionsSample}
              items={[
                {
                  value: "ready",
                  label: "Con aportes",
                  disabled: state.pending,
                },
                {
                  value: "loading",
                  label: "Cargando",
                  disabled: state.pending,
                },
                { value: "empty", label: "Vacío", disabled: state.pending },
                { value: "error", label: "Error", disabled: state.pending },
              ]}
            />
          </div>
          <div>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!state.pending}
              onClick={completeContributionsRead}
            >
              Completar lectura de muestra
            </Button>
          </div>
        </header>
        <section aria-label="Página real de Admin">
          <Routes>
            <Route
              path="/admin-contributions-demo.html"
              element={<Contributions key={state.sample} />}
            />
            <Route path="*" element={<Destination />} />
          </Routes>
        </section>
        <Toaster {...toasterConfig} />
      </main>
    </BrowserRouter>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() => createRoot(document.getElementById("root")!).render(<Demo />));
