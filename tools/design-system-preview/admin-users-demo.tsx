import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Users } from "../../app/ui/src/pages/Users";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
import { Button } from "@crate/ui/shadcn/button";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
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
  installSampleClipboard,
} from "./admin-users-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot),
    [viewOnly, setViewOnly] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (!state.pending) {
      setDialogTarget(null);
      return;
    }
    const update = () => {
      const active = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).filter(
        (element) =>
          element.getAttribute("data-state") !== "closed" &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getBoundingClientRect().width > 0,
      );
      setDialogTarget(active[active.length - 1] ?? null);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [state.pending]);
  const user = {
    id: 999,
    name: "Revisor de muestra",
    email: "reviewer@example.test",
    role: "admin",
    roles: ["admin"],
  };
  const auth: AuthContextValue = {
    user,
    actualUser: user,
    loading: false,
    isAdmin: !viewOnly,
    canAccessAdmin: true,
    hasCapability: (cap) => !viewOnly || cap === "users.view",
    hasAnyCapability: (caps) => !viewOnly || caps.includes("users.view"),
    logout: () => {},
    refetch: () => {},
    rolePresets: [],
    previewRole: null,
    setPreviewRole: () => {},
    clearRolePreview: () => {},
  };
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <main className="grid min-w-0 grid-cols-1 gap-6 p-4 sm:p-6">
          <header className="grid gap-4 border-b border-border-quiet pb-6">
            <p className="text-sm text-text-muted">
              Página real de Admin · usuarios y sesiones ficticios. Listado y
              detalle sin mapa. Los cambios, invitaciones y copias solo afectan
              a esta muestra; no se consulta un backend ni se cambia ningún
              acceso real.
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
                    label: "Con usuarios",
                    disabled: state.pending,
                  },
                  {
                    value: "loading",
                    label: "Cargando",
                    disabled: state.pending,
                  },
                  { value: "empty", label: "Vacío", disabled: state.pending },
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
                Completar acción de muestra
              </Button>
              <FormField layout="inline" label="Solo lectura">
                <Checkbox
                  checked={viewOnly}
                  disabled={state.pending}
                  onCheckedChange={(checked) => setViewOnly(checked === true)}
                />
              </FormField>
              <FormField layout="inline" label="La siguiente acción fallará">
                <Checkbox
                  checked={state.failNext}
                  disabled={state.pending}
                  onCheckedChange={(checked) => setFailure(checked === true)}
                />
              </FormField>
            </div>
            <p
              role="status"
              aria-label="Acción de muestra"
              className="font-mono text-xs"
            >
              {state.action}
            </p>
          </header>
          <section aria-label="Página real de Users">
            <Users key={`${state.sample}:${viewOnly}`} />
          </section>
          <Toaster {...toasterConfig} />
          {state.pending && dialogTarget
            ? createPortal(
                <div className="grid gap-2 border-t border-border-quiet pt-3">
                  <p className="font-mono text-xs text-text-muted">
                    Acción local pendiente; solo datos de muestra.
                  </p>
                  <Button
                    className="min-h-11"
                    variant="outline"
                    onClick={complete}
                  >
                    Completar acción de muestra
                  </Button>
                </div>,
                dialogTarget,
              )
            : null}
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
applyCrateIdentity();
installSampleClipboard();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
