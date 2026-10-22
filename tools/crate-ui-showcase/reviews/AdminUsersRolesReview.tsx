import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { useState, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { Roles } from "../../../app/ui/src/pages/Roles";
import { Users } from "../../../app/ui/src/pages/Users";
import {
  completeRead,
  setSample,
  snapshot,
  subscribe,
  type Sample,
} from "../../design-system-preview/admin-users-roles-fixtures";

type ReviewPage = "users" | "roles";

function ReviewControls({
  page,
  setPage,
  viewOnly,
  setViewOnly,
}: {
  page: ReviewPage;
  setPage: (page: ReviewPage) => void;
  viewOnly: boolean;
  setViewOnly: (value: boolean) => void;
}) {
  const state = useSyncExternalStore(subscribe, snapshot);

  return (
    <header
      data-admin-review-controls="users-roles"
      className="grid min-w-0 gap-4 border-b border-border-quiet pb-5"
    >
      <p className="m-0 max-w-4xl text-sm text-text-muted">
        Users and Roles real pages · datos ficticios en memoria. No se conecta a
        un backend ni se modifican cuentas o permisos reales.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FormField kind="group" label="Página de revisión" className="min-w-0">
          <SegmentedControl
            as="radio"
            label="Página de revisión"
            className="min-w-0"
            value={page}
            onValueChange={(value) => setPage(value as ReviewPage)}
            items={[
              { value: "users", label: "Users" },
              { value: "roles", label: "Roles" },
            ]}
          />
        </FormField>
        <FormField kind="group" label="Estado de muestra" className="min-w-0">
          <SegmentedControl
            as="radio"
            label="Estado de muestra"
            className="min-w-0"
            value={state.sample}
            onValueChange={(value) => setSample(value as Sample)}
            items={[
              { value: "ready", label: "Datos", disabled: state.pending },
              {
                value: "loading",
                label: "Carga",
                disabled: state.pending,
              },
              { value: "empty", label: "Vacío", disabled: state.pending },
              { value: "error", label: "Error", disabled: state.pending },
            ]}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11"
          variant="outline"
          disabled={!state.pending}
          onClick={completeRead}
        >
          Completar lectura de muestra
        </Button>
        <FormField
          layout="inline"
          label="Cuenta de solo lectura"
          className="min-w-0"
        >
          <Checkbox
            checked={viewOnly}
            disabled={state.pending}
            onCheckedChange={(checked) => setViewOnly(checked === true)}
          />
        </FormField>
        <span
          role="status"
          className="min-w-0 break-words font-mono text-xs text-text-muted"
        >
          {state.action}
        </span>
      </div>
    </header>
  );
}

export function AdminUsersRolesReview({
  initialPage = "users",
}: {
  initialPage?: ReviewPage;
}) {
  const [page, setPage] = useState<ReviewPage>(initialPage);
  const [viewOnly, setViewOnly] = useState(false);
  const state = useSyncExternalStore(subscribe, snapshot);
  const user = {
    id: 999,
    email: "reviewer@example.test",
    name: "Review account",
    role: viewOnly ? "user" : "owner",
    roles: [viewOnly ? "user" : "owner"],
  };
  const auth: AuthContextValue = {
    user,
    actualUser: user,
    loading: false,
    isAdmin: !viewOnly,
    canAccessAdmin: true,
    hasCapability: (capability) =>
      !viewOnly || ["users.view", "roles.view"].includes(capability),
    hasAnyCapability: (capabilities) =>
      capabilities.some(
        (capability) =>
          !viewOnly || ["users.view", "roles.view"].includes(capability),
      ),
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
        <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
          <ReviewControls
            page={page}
            setPage={setPage}
            viewOnly={viewOnly}
            setViewOnly={setViewOnly}
          />
          <section
            key={`${page}:${state.sample}:${viewOnly}`}
            aria-label={`Página real de ${page === "users" ? "Users" : "Roles"}`}
            className="min-w-0"
          >
            {page === "users" ? <Users /> : <Roles />}
          </section>
          <Toaster {...toasterConfig} />
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
