import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminSystemHealthCheckpoint() {
  return (
    <section
      id="sistema-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AC, System Health de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="30">
            Checkpoint 1AC · Publicado
          </MonoLabel>
          <h2>Las métricas, por su nombre.</h2>
        </div>
        <p>
          System Health conserva sus datos e instrumentos. Las lecturas y
          acciones prescinden de decoración.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real, métricas ficticias y controles locales. Prueba
        las ventanas de 1h y 24h, la actualización y las dos muestras; recorre
        recursos, reproducción y gráficos.
      </p>
      <iframe
        title="System Health real con métricas de muestra"
        src="./admin-system-health-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-system-health-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir System Health en una pestaña
      </a>
    </section>
  );
}
