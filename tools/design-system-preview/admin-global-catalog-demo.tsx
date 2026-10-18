import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { GlobalCatalog } from "../../app/ui/src/pages/GlobalCatalog";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
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
  setServing,
  setManage,
  setFailure,
  advance,
} from "./admin-global-catalog-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const auth: AuthContextValue = {
    user: {
      id: 1,
      name: "Muestra",
      email: "sample@example.invalid",
      role: "sample",
    },
    loading: false,
    isAdmin: false,
    canAccessAdmin: true,
    logout: () => {},
    refetch: () => {},
    hasCapability: (cap) => state.manage && cap === "federation.policy.manage",
    hasAnyCapability: (caps) =>
      state.manage && caps.includes("federation.policy.manage"),
  };
  return (
    <div className="grid grid-cols-1 gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · catálogo, fuentes y ejecuciones ficticios. Sin
          backend ni reconciliaciones reales. El envío y las lecturas
          posteriores se completan por separado; en producción el botón encola
          trabajo.
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
                value: "error",
                label: "Error de lectura",
                disabled: state.pending > 0,
              },
            ]}
          />
        </div>
        <div className="crate-form-field">
          <MonoLabel as="span">Servicio del catálogo</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Servicio del catálogo"
            value={state.serving}
            onValueChange={setServing}
            items={[
              {
                value: "global-ready",
                label: "Listo",
                disabled: state.pending > 0,
              },
              {
                value: "global-refreshing",
                label: "Actualizando",
                disabled: state.pending > 0,
              },
              {
                value: "global-degraded",
                label: "Degradado",
                disabled: state.pending > 0,
              },
              {
                value: "local-fallback",
                label: "Fallback local",
                disabled: state.pending > 0,
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            className="min-h-11"
            variant="outline"
            disabled={!state.pending}
            onClick={advance}
          >
            Completar siguiente paso de muestra
          </Button>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={state.manage}
              onChange={(event) => setManage(event.target.checked)}
            />
            Permitir gestión de muestra
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={state.failNext}
              onChange={(event) => setFailure(event.target.checked)}
            />
            Fallar el siguiente envío
          </label>
        </div>
        <p className="break-all font-mono text-xs" role="status">
          {state.action} · {state.pending} pasos pendientes
        </p>
        {state.sample === "error" ? (
          <p className="text-sm text-text-muted">
            Fallo de lectura simulado. La página conserva su comportamiento
            actual: estado desconocido y ceros de reserva, no datos confirmados.
          </p>
        ) : null}
      </header>
      <AuthContext.Provider value={auth}>
        <section aria-label="Página real de Global Catalog">
          <GlobalCatalog key={`${state.sample}:${state.serving}`} />
        </section>
      </AuthContext.Provider>
      <Toaster {...toasterConfig} />
    </div>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
