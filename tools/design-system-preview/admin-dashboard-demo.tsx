import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { Dashboard } from "../../app/ui/src/pages/Dashboard";
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
  dashboardSampleState,
  setDashboardSample,
  subscribeDashboardSample,
} from "./admin-dashboard-fixtures";
import "./admin-navigation-demo.css";

function Destination() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <div className="grid gap-4">
      <output
        aria-label="Ruta de muestra"
        className="font-mono text-sm break-all"
      >
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <Button
        variant="outline"
        className="min-h-11 justify-self-start"
        onClick={() => navigate("/")}
      >
        Volver a Dashboard
      </Button>
    </div>
  );
}
function Demo() {
  const { sample, outcome, refreshCount } = useSyncExternalStore(
    subscribeDashboardSample,
    dashboardSampleState,
  );
  const [isAdmin, setIsAdmin] = useState(true);
  const user = {
    id: 1,
    name: "Muestra",
    email: "sample@example.test",
    role: isAdmin ? "admin" : "curator",
    roles: [isAdmin ? "admin" : "curator"],
  };
  const auth: AuthContextValue = {
    user,
    actualUser: user,
    loading: false,
    isAdmin,
    canAccessAdmin: true,
    hasCapability: () => true,
    hasAnyCapability: () => true,
    logout: () => {},
    refetch: () => {},
    rolePresets: [],
    previewRole: null,
    setPreviewRole: () => {},
    clearRolePreview: () => {},
  };
  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <header className="grid gap-4 border-b border-border-quiet pb-6">
        <p className="text-sm text-text-muted">
          Página real de Admin · datos ficticios. Navegación y acciones locales;
          no modifica una biblioteca. Actualizar renueva el informe de muestra.
        </p>
        <div className="crate-form-field">
          <MonoLabel as="span">Estado de muestra</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            value={sample}
            onValueChange={setDashboardSample}
            items={[
              { value: "ready", label: "En curso" },
              { value: "loading", label: "Cargando" },
              { value: "empty", label: "En reposo" },
              { value: "interruption", label: "Interrupción" },
              { value: "stale", label: "Desactualizado" },
              { value: "partial", label: "Parcial" },
              { value: "offline", label: "Sin servicio" },
            ]}
          />
        </div>
        <FormField layout="inline" label="Permitir mantenimiento de muestra">
          <Checkbox
            checked={isAdmin}
            onCheckedChange={(checked) => setIsAdmin(checked === true)}
          />
        </FormField>
        <output
          aria-label="Última acción de muestra"
          className="font-mono text-xs break-all"
        >
          {outcome}
        </output>
        <p className="font-mono text-label text-text-subtle">
          Actualizaciones de muestra: {refreshCount}
        </p>
      </header>
      <AuthContext.Provider value={auth}>
        <section key={sample} aria-label="Página real de Admin">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="*" element={<Destination />} />
          </Routes>
        </section>
      </AuthContext.Provider>
      <Toaster {...toasterConfig} />
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
