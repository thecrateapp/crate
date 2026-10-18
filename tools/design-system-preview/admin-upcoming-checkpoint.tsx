import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminUpcomingCheckpoint() {
  return (
    <section
      id="proximamente-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AO, Upcoming de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="39">
            Checkpoint 1AO · Publicado
          </MonoLabel>
          <h2>Lo que viene, por su nombre.</h2>
        </div>
        <p>
          Lanzamientos y conciertos con sus datos y acciones reales. Calendario,
          búsqueda, navegación, cierre y enlaces externos conservan sus glifos
          de UX.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Página real con datos ficticios. Conserva filtros, lista, calendario y
        acciones. Los cambios se completan manualmente y son locales a esta
        muestra.
      </p>
      <iframe
        title="Upcoming real con datos de muestra"
        src="./admin-upcoming-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-upcoming-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Upcoming en una pestaña
      </a>
    </section>
  );
}
