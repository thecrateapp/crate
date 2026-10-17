import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminControlsCheckpoint() {
  return (
    <section
      id="controles-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1X, Controles de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="25">
            Checkpoint 1X · En revisión
          </MonoLabel>
          <h2>La acción se lee.</h2>
        </div>
        <p>
          Resultados, búsquedas recientes y asistencia por su nombre. Los glifos
          de búsqueda, carga, limpieza y selección conservan su función.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Este ejemplo usa el buscador, el botón de IA y el selector
        compartido reales con datos ficticios. Listen y Desktop conservan sus
        controles.
      </p>
      <iframe
        title="Controles reales de Admin con datos de muestra"
        src="./admin-controls-demo.html"
        className="mt-6 h-[900px] w-full border border-border-quiet"
      />
      <a
        href="./admin-controls-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir la muestra de controles en una pestaña
      </a>
    </section>
  );
}
