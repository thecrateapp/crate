import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { Imports } from "../../../app/ui/src/pages/Imports";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";

const capabilities = ["library.import.manage"];
const auth: AuthContextValue = {
  user: {
    id: 1,
    name: "Sample Administrator",
    email: "admin@example.invalid",
    role: "admin",
    roles: ["admin"],
    capabilities,
  },
  actualUser: null,
  loading: false,
  isAdmin: true,
  canAccessAdmin: true,
  logout: async () => {},
  refetch: async () => {},
  hasCapability: (capability) => capabilities.includes(capability),
  hasAnyCapability: (required) =>
    required.some((capability) => capabilities.includes(capability)),
  rolePresets: [],
  previewRole: null,
  setPreviewRole: () => {},
  clearRolePreview: () => {},
};

export function AdminImportsReview() {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <div className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
          <p className="m-0 border-b border-border-quiet pb-4 text-sm text-text-muted">
            Página real de Admin · cola, actividad y metadatos de muestra. Las
            acciones son locales; no se ejecutan imports ni borrados reales.
          </p>
          <section
            aria-label="Página real de Staged Imports"
            className="min-w-0"
          >
            <Imports />
          </section>
        </div>
      </AuthContext.Provider>
      <Toaster {...toasterConfig} />
    </MemoryRouter>
  );
}
