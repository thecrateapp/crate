import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminHealthCheckpoint() {
  return (
    <section
      id="salud-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AD, Library Health de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="31">
            Checkpoint 1AD · Publicado
          </MonoLabel>
          <h2>Los problemas, primero.</h2>
        </div>
        <p>
          Incidencias por gravedad, casos concretos y cómo resolverlos. La
          actividad y las comprobaciones quedan como consulta secundaria.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con sesión e incidencias ficticias. Abre los
        grupos, prueba las acciones y sus confirmaciones o completa una tarea de
        muestra. Comprueba también los estados sin resultado, desactualizado y
        de lista limitada. Los datos son ficticios; los controles son los
        reales.
      </p>
      <iframe
        title="Library Health real con incidencias de muestra"
        src="./admin-health-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-health-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Library Health en una pestaña
      </a>
    </section>
  );
}
