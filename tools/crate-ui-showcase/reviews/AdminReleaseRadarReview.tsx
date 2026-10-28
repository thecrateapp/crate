import { MemoryRouter } from "react-router";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { NewReleases } from "../../../app/ui/src/pages/NewReleases";

const viewer = {
  id: 1,
  name: "Muestra",
  email: "sample@example.invalid",
  role: "release-curator",
  roles: ["release-curator"],
  capabilities: ["curation.releases.write", "library.tidal.manage"],
};

const auth: AuthContextValue = {
  user: viewer,
  loading: false,
  isAdmin: false,
  canAccessAdmin: true,
  hasCapability: (capability) => viewer.capabilities.includes(capability),
  hasAnyCapability: (capabilities) =>
    capabilities.some((capability) => viewer.capabilities.includes(capability)),
  logout: () => {},
  refetch: () => {},
};

export function AdminReleaseRadarReview() {
  return (
    <MemoryRouter initialEntries={["/new-releases"]}>
      <AuthContext.Provider value={auth}>
        <main className="min-w-0 p-4 sm:p-6">
          <p className="mb-6 border-b border-border-quiet pb-4 text-sm text-text-muted">
            Página real de Release Radar con datos ficticios. Separa la fecha de
            publicación, el estado de adquisición y las pistas ya disponibles en
            Crate.
          </p>
          <NewReleases />
        </main>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
