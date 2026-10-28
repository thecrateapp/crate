import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminDashboardCheckpoint() {
  return (
    <section
      id="dashboard-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AB, Dashboard de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="29">
            Checkpoint 1AB · Publicado
          </MonoLabel>
          <h2>El estado, sin ruido.</h2>
        </div>
        <p>
          Estado del informe, trabajo reportado e interrupciones. Tres bloques
          con las señales que ya existen.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con informes, sesión y acciones ficticios, sin
        backend. Prueba actividad, reposo, interrupción, datos antiguos y datos
        parciales. Actualizar renueva la muestra; mantenimiento conserva sus
        confirmaciones. No se presupone que los workers estén disponibles.
      </p>
      <iframe
        title="Dashboard real con datos de muestra"
        src="./admin-dashboard-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-dashboard-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Dashboard en una pestaña
      </a>
    </section>
  );
}
