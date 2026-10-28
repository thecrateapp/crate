import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminTranslationsCheckpoint() {
  return (
    <section
      id="traducciones-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AN, Translations de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="38">
            Checkpoint 1AN · Publicado
          </MonoLabel>
          <h2>Cada traducción, con contexto.</h2>
        </div>
        <p>
          Idiomas, borradores y revisión. Conserva los datos, filtros y acciones
          disponibles para revisar y publicar traducciones.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Página real con datos ficticios. Conserva filtros, edición, revisión y
        exportación. Los cambios se completan manualmente y son locales a esta
        muestra.
      </p>
      <iframe
        title="Translations real con datos de muestra"
        src="./admin-translations-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-translations-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Translations en una pestaña
      </a>
    </section>
  );
}
