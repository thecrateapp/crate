import { MemoryRouter } from "react-router";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { Upcoming } from "../../../app/ui/src/pages/Upcoming";

const curator = {
  id: 2,
  name: "Muestra",
  email: "sample@example.invalid",
  role: "show-curator",
  roles: ["show-curator"],
  capabilities: ["curation.shows.write", "library.metadata.write"],
};

const auth: AuthContextValue = {
  user: curator,
  loading: false,
  isAdmin: false,
  canAccessAdmin: true,
  hasCapability: (capability) => curator.capabilities.includes(capability),
  hasAnyCapability: (capabilities) =>
    capabilities.some((capability) => curator.capabilities.includes(capability)),
  logout: () => {},
  refetch: () => {},
};

export function AdminShowManagementReview() {
  return (
    <MemoryRouter initialEntries={["/upcoming"]}>
      <AuthContext.Provider value={auth}>
        <main className="min-w-0 p-4 sm:p-6">
          <p className="mb-6 border-b border-border-quiet pb-4 text-sm text-text-muted">
            Página real de Show Management con datos ficticios. Revisa la fecha,
            el lugar, las acciones del show y la vigencia de cada setlist del
            cartel.
          </p>
          <Upcoming />
        </main>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
