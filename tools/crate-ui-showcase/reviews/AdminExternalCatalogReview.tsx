import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { Button } from "@crate/ui/shadcn/button";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { Bandcamp } from "../../../app/ui/src/pages/Bandcamp";
import { GlobalCatalog } from "../../../app/ui/src/pages/GlobalCatalog";
import * as bandcampFixture from "../../design-system-preview/admin-bandcamp-fixtures";
import * as catalogFixture from "../../design-system-preview/admin-global-catalog-fixtures";

const sampleUser = {
  id: 1,
  name: "Muestra",
  email: "sample@example.invalid",
  role: "admin",
  roles: ["admin"],
  capabilities: ["library.bandcamp.manage", "federation.policy.manage"],
};

const catalogAuth: AuthContextValue = {
  user: sampleUser,
  actualUser: sampleUser,
  loading: false,
  isAdmin: true,
  canAccessAdmin: true,
  hasCapability: (capability) => sampleUser.capabilities.includes(capability),
  hasAnyCapability: (capabilities) =>
    capabilities.some((capability) =>
      sampleUser.capabilities.includes(capability),
    ),
  logout: () => {},
  refetch: () => {},
};

export function AdminBandcampReview() {
  const state = useSyncExternalStore(
    bandcampFixture.subscribe,
    bandcampFixture.snapshot,
  );

  return (
    <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
      <p className="m-0 border-b border-border-quiet pb-4 text-sm text-text-muted">
        Página real de Admin con conexión, compras, correspondencias y tareas
        ficticias. No consulta Bandcamp ni modifica una biblioteca.
      </p>
      <Button
        variant="outline"
        className="min-h-11 w-fit"
        disabled={!state.pending}
        onClick={bandcampFixture.complete}
      >
        Complete sample action
      </Button>
      <section aria-label="Página real de Bandcamp" className="min-w-0">
        <Bandcamp />
      </section>
      <Toaster {...toasterConfig} />
    </main>
  );
}

export function AdminGlobalCatalogReview() {
  const state = useSyncExternalStore(
    catalogFixture.subscribe,
    catalogFixture.snapshot,
  );

  return (
    <AuthContext.Provider value={catalogAuth}>
      <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
        <p className="m-0 border-b border-border-quiet pb-4 text-sm text-text-muted">
          Página real de Admin con catálogo, fuentes y ejecuciones ficticias. El
          envío y las lecturas posteriores se completan por separado; no se
          inicia una reconciliación real.
        </p>
        <Button
          variant="outline"
          className="min-h-11 w-fit"
          disabled={!state.pending}
          onClick={catalogFixture.advance}
        >
          Complete next sample step
        </Button>
        <section aria-label="Página real de Global Catalog" className="min-w-0">
          <GlobalCatalog />
        </section>
        <Toaster {...toasterConfig} />
      </main>
    </AuthContext.Provider>
  );
}
