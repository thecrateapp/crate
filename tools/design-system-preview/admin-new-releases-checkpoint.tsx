import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminNewReleasesCheckpoint() {
  return (
    <section
      id="lanzamientos-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AJ, New Releases de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="34">
            Checkpoint 1AJ · Publicado
          </MonoLabel>
          <h2>Lanzamientos, por su nombre.</h2>
        </div>
        <p>
          Lista y cuadrícula mantienen sus datos y acciones. Búsqueda, carga y
          descarte conservan sus glifos de UX.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con datos y permisos ficticios: prueba búsqueda,
        tipos, estados, descarga, descarte y chequeo por pasos. SSE local
        permite revisar una actualización sin backend.
      </p>
      <iframe
        title="New Releases real con datos de muestra"
        src="./admin-new-releases-demo.html"
        className="mt-6 h-[1500px] w-full border border-border-quiet"
      />
      <a
        href="./admin-new-releases-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir New Releases en una pestaña
      </a>
    </section>
  );
}
