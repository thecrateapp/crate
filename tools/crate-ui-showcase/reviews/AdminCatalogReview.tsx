import { Button } from "@crate/ui/shadcn/button";
import {
  AuthContext,
  type AuthContextValue,
} from "../../../app/ui/src/contexts/AuthContext";
import { Browse } from "../../../app/ui/src/pages/Browse";
import { Genres } from "../../../app/ui/src/pages/Genres";
import { Link, MemoryRouter, Route, Routes } from "react-router";

const previewAuth: AuthContextValue = {
  user: null,
  actualUser: null,
  loading: false,
  logout: () => {},
  isAdmin: false,
  canAccessAdmin: true,
  hasCapability: () => false,
  hasAnyCapability: () => false,
  refetch: () => {},
};

export function AdminCatalogReview() {
  return (
    <AuthContext.Provider value={previewAuth}>
      <MemoryRouter initialEntries={["/browse"]}>
        <main className="grid min-h-screen content-start gap-6 p-4 sm:p-6">
          <header className="flex flex-col gap-3 border-b border-border-quiet pb-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">
              Páginas reales de Admin · datos de muestra, sin conexión a la API.
            </p>
            <nav aria-label="Páginas del catálogo" className="flex gap-2">
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/browse">Artists</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/genres">Genres</Link>
              </Button>
            </nav>
          </header>
          <section aria-label="Página real de Admin" className="min-w-0">
            <Routes>
              <Route path="/browse" element={<Browse />} />
              <Route path="/genres" element={<Genres />} />
              <Route path="*" element={<Browse />} />
            </Routes>
          </section>
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
