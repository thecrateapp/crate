import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminOperationsCheckpoint() {
  return (
    <section
      id="operaciones-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1Z, Logs y Stack de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="27">
            Checkpoint 1Z · Publicado
          </MonoLabel>
          <h2>Control con nombre.</h2>
        </div>
        <p>
          Logs y servicios con acciones legibles. Búsqueda, carga, pausa, inicio
          y despliegue mantienen sus glifos funcionales.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Ambas páginas son reales; los datos, los streams y las
        acciones de esta muestra son ficticios. Cambia entre Logs y Stack para
        revisar los estados y los controles.
      </p>
      <iframe
        title="Logs y Stack reales con datos de muestra"
        src="./admin-operations-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-operations-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Logs y Stack en una pestaña
      </a>
    </section>
  );
}
