import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminUpcomingCheckpoint() {
  return (
    <section
      id="proximamente-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AO, Show Management de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="39">
            Checkpoint 1AO · Publicado
          </MonoLabel>
          <h2>Lo que viene, por su nombre.</h2>
        </div>
        <p>
          Shows en una superficie propia, con navegación por fecha, artista,
          venue y setlists recientes para cada integrante del cartel.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Página real con datos ficticios. Permite revisar la cobertura de
        setlists, abrir el detalle de cada show y probar acciones locales.
      </p>
      <iframe
        title="Show Management real con datos de muestra"
        src="./admin-upcoming-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-upcoming-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Show Management en una pestaña
      </a>
    </section>
  );
}
