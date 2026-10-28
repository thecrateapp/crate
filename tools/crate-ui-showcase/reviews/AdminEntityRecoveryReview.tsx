import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MemoryRouter } from "react-router";

export function AdminEntityRecoveryReview() {
  return (
    <MemoryRouter>
      <main className="mx-auto grid min-h-screen w-full max-w-6xl content-start gap-8 p-6 md:p-10">
        <header className="border-b border-border-quiet pb-5">
          <p className="text-sm text-text-muted">
            Estados de recuperación de las páginas reales de artista y álbum.
          </p>
        </header>
        <section className="grid gap-10 md:grid-cols-2">
          <ErrorState
            variant="page"
            kind="error"
            title="Artist unavailable"
            message="This artist could not be loaded. Try again or return to Browse."
            onRetry={() => {}}
            backTo="/browse"
            backLabel="Browse artists"
          />
          <ErrorState
            variant="page"
            kind="notFound"
            title="Album not found"
            message="This album is not available in the catalog."
            backTo="/browse"
            backLabel="Browse artists"
          />
        </section>
      </main>
    </MemoryRouter>
  );
}
