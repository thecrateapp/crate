import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminBandcampCheckpoint() {
  return (
    <section
      id="bandcamp-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AH, Bandcamp de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="32">
            Checkpoint 1AH · Publicado
          </MonoLabel>
          <h2>Las correspondencias, por su nombre.</h2>
        </div>
        <p>
          Bandcamp sin iconos redundantes. Carga y apertura externa conservan
          sus señales de UX; cifras, conexión y acciones mantienen sus datos.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con conexión, colección y acciones ficticias.
        Prueba sincronizar, actualizar Radar, revisar correspondencias y
        completar una tarea o un fallo. Los enlaces externos abren destinos
        locales de muestra.
      </p>
      <iframe
        title="Bandcamp real con datos de muestra"
        src="./admin-bandcamp-demo.html"
        className="mt-6 h-[1250px] w-full border border-border-quiet"
      />
      <a
        href="./admin-bandcamp-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Bandcamp en una pestaña
      </a>
    </section>
  );
}
