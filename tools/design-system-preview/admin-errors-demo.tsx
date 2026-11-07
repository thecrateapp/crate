import { useSyncExternalStore, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, NavLink, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { TooltipProvider } from "@crate/ui/shadcn/tooltip";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { Errors } from "../../app/ui/src/pages/Errors";
import { ErrorDetail } from "../../app/ui/src/pages/ErrorDetail";
import { ErrorsTile } from "../../app/ui/src/components/system-health/ErrorsTile";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
import {
  NOT_CONFIGURED_SUMMARY,
  sampleSummary,
} from "../../app/ui/src/test/error-inbox-fixtures";
import {
  SCENARIOS,
  setScenario,
  snapshot,
  subscribe,
  type ErrorsScenario,
} from "./admin-errors-fixtures";
import "./admin-navigation-demo.css";

type Role = "admin" | "viewer";

const ALL = [
  "ops.errors.view",
  "ops.errors.manage",
  "ops.runtime.manage",
  "ops.health.view",
];
const VIEWER = ["ops.errors.view", "ops.health.view"];

function authFor(role: Role): AuthContextValue {
  const granted = role === "admin" ? ALL : VIEWER;
  const user = {
    id: 999,
    name: "Revisor de muestra",
    email: "reviewer@example.test",
    role,
    roles: [role],
  };
  return {
    user,
    actualUser: user,
    loading: false,
    isAdmin: role === "admin",
    canAccessAdmin: true,
    hasCapability: (capability) => granted.includes(capability),
    hasAnyCapability: (required) =>
      required.some((capability) => granted.includes(capability)),
    logout: () => {},
    refetch: () => {},
    rolePresets: [],
    previewRole: null,
    setPreviewRole: () => {},
    clearRolePreview: () => {},
  };
}

function TilePreview() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const errors = !state.connection.configured
    ? NOT_CONFIGURED_SUMMARY
    : {
        ...sampleSummary({}, state.issues),
        sync: state.connection.sync,
      };
  return (
    <div className="space-y-6">
      <h1 className="crate-page-title" data-size="md">
        System Health
      </h1>
      <p className="m-0 text-sm text-text-muted">
        Tile from the dashboard&apos;s <code>errors</code> field, shown alone.
      </p>
      <ErrorsTile errors={errors} />
      <ErrorsTile errors={null} />
    </div>
  );
}

const params = new URLSearchParams(window.location.search);
const initialScenario = (SCENARIOS.find(
  (item) => item.value === params.get("scenario"),
)?.value ?? "ready") as ErrorsScenario;
const initialPath = params.get("path") ?? "/errors";
const initialRole: Role = params.get("role") === "viewer" ? "viewer" : "admin";
setScenario(initialScenario);

function DemoNavLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `inline-flex min-h-11 items-center ${isActive ? "text-accent-action-hi" : "text-text-secondary hover:text-accent-action-hi"}`
      }
    >
      <MonoLabel as="span" className="text-current">
        {children}
      </MonoLabel>
    </NavLink>
  );
}

function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const [role, setRole] = useState<Role>(initialRole);
  const firstIssue = state.issues[0]?.id ?? "missing";
  return (
    <AuthContext.Provider value={authFor(role)}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <main className="grid min-w-0 grid-cols-1 gap-6 p-4 sm:p-6">
            <header
              data-preview-controls
              className="grid gap-4 border-b border-border-quiet pb-6"
            >
              <p className="m-0 text-sm text-text-muted">
                Página real de Admin · Error Inbox (E1.PR4) con datos ficticios.
                Sin backend ni Sentry: los cambios de estado y la prueba de
                conexión terminan solos tras un segundo.
              </p>
              <div className="flex flex-wrap items-end gap-6">
                <div className="crate-form-field">
                  <MonoLabel as="span">Escenario</MonoLabel>
                  <SegmentedControl<ErrorsScenario>
                    as="radio"
                    label="Escenario"
                    value={state.scenario}
                    onValueChange={setScenario}
                    items={SCENARIOS}
                  />
                </div>
                <div className="crate-form-field">
                  <MonoLabel as="span">Permisos</MonoLabel>
                  <SegmentedControl<Role>
                    as="radio"
                    label="Permisos"
                    value={role}
                    onValueChange={setRole}
                    items={[
                      { value: "admin", label: "Admin" },
                      { value: "viewer", label: "Solo lectura" },
                    ]}
                  />
                </div>
              </div>
              <nav aria-label="Vistas de muestra" className="flex gap-6">
                <DemoNavLink to="/errors">Errors</DemoNavLink>
                <DemoNavLink to={`/errors/${firstIssue}`}>Issue</DemoNavLink>
                <DemoNavLink to="/system">System Health tile</DemoNavLink>
              </nav>
            </header>
            <section
              aria-label="Página real de Admin"
              className="mx-auto w-full max-w-[1240px] min-w-0"
            >
              <Routes key={`${state.scenario}:${role}`}>
                <Route path="/errors" element={<Errors />} />
                <Route path="/errors/:id" element={<ErrorDetail />} />
                <Route path="/system" element={<TilePreview />} />
              </Routes>
            </section>
          </main>
        </MemoryRouter>
      </TooltipProvider>
      <Toaster {...toasterConfig} theme="dark" position="bottom-right" />
    </AuthContext.Provider>
  );
}

applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
