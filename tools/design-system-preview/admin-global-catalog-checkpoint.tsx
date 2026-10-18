import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminGlobalCatalogCheckpoint() {
  return (
    <section
      id="catalogo-global-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AK, Global Catalog de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="35">
            Checkpoint 1AK · Publicado
          </MonoLabel>
          <h2>El catálogo, con palabras.</h2>
        </div>
        <p>
          Estado, cifras y fuentes por su nombre. Se conservan los indicadores
          de carga de ambas reconciliaciones.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con datos y permisos ficticios: revisa vistas,
        servicio del catálogo, modo incremental/completo y bloqueo durante el
        envío y lecturas posteriores asíncronas. No ejecuta tareas reales.
      </p>
      <iframe
        title="Global Catalog real con datos de muestra"
        src="./admin-global-catalog-demo.html"
        className="mt-6 h-[1250px] w-full border border-border-quiet"
      />
      <a
        href="./admin-global-catalog-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Global Catalog en una pestaña
      </a>
    </section>
  );
}
