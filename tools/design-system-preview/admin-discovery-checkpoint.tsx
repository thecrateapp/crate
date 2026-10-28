import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminDiscoveryCheckpoint() {
  return (
    <section
      id="discovery-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AI, Discovery de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="33">
            Checkpoint 1AI · Publicado
          </MonoLabel>
          <h2>Descubrir, con contexto.</h2>
        </div>
        <p>
          Oportunidades, lanzamientos y señales por su nombre. Búsqueda y carga
          conservan sus glifos de UX; tareas, filtros y destinos mantienen sus
          contratos.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con datos y tareas ficticios. Prueba búsqueda,
        navegación, recomputación completa o parcial y fallos. El envío y la
        tarea se completan en pasos separados; no se ejecuta trabajo real.
      </p>
      <iframe
        title="Discovery real con datos de muestra"
        src="./admin-discovery-demo.html"
        className="mt-6 h-[1250px] w-full border border-border-quiet"
      />
      <a
        href="./admin-discovery-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Discovery en una pestaña
      </a>
    </section>
  );
}
