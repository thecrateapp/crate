import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { resetImportsFixture } from "./admin-imports-fixtures";
import { Imports } from "../../app/ui/src/pages/Imports";
import {
  AuthContext,
  type AuthContextValue,
} from "../../app/ui/src/contexts/AuthContext";
import "./admin-navigation-demo.css";

applyCrateIdentity();
resetImportsFixture();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);

const capabilities = ["library.import.manage"];
const auth: AuthContextValue = {
  user: {
    id: 1,
    name: "Sample Administrator",
    email: "admin@example.invalid",
    role: "admin",
    capabilities,
  },
  loading: false,
  isAdmin: true,
  canAccessAdmin: true,
  logout: () => {},
  refetch: () => {},
  hasCapability: (capability) => capabilities.includes(capability),
  hasAnyCapability: (required) =>
    required.some((capability) => capabilities.includes(capability)),
};

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthContext.Provider value={auth}>
      <div className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
        <p className="m-0 border-b border-border-quiet pb-4 text-sm text-text-muted">
          Página real de Admin · cola, actividad y metadatos de muestra. Las
          acciones son locales; no se ejecutan imports ni borrados reales.
        </p>
        <section aria-label="Página real de Staged Imports" className="min-w-0">
          <Imports />
        </section>
      </div>
    </AuthContext.Provider>
    <Toaster {...toasterConfig} />
  </BrowserRouter>,
);
