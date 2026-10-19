import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminPlaylistsCheckpoint() {
  return (
    <section
      id="playlists-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AP, System Playlists de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="40">
            Checkpoint 1AP · Publicado
          </MonoLabel>
          <h2>Playlists con nombre y portada.</h2>
        </div>
        <p>
          Acciones de texto para crear, activar y eliminar. Búsqueda, carga y
          cierre conservan sus glifos de UX; las portadas mantienen la identidad
          de Crate.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Página real con datos ficticios y acciones locales. Los filtros, reglas
        y creación conservan sus contratos. Listen mantiene sus portadas
        actuales.
      </p>
      <iframe
        title="System Playlists real con datos de muestra"
        src="./admin-playlists-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-playlists-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir System Playlists en una pestaña
      </a>
      <div className="mt-8 grid gap-4 border-t border-border-quiet pt-6">
        <h3 className="font-display text-xl">Reconciliación de la auditoría</h3>
        <p className="text-sm text-text-muted">
          Contraste de los filtros, roles tipográficos y etiquetas compartidas
          corregidos. Las páginas siguientes montan sus componentes reales con
          los mismos datos ficticios de los checkpoints publicados.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            ["navigation", "Navegación"],
            ["roles", "Roles"],
            ["users", "Usuarios"],
            ["translations", "Traducciones"],
            ["bandcamp", "Bandcamp"],
            ["upcoming", "Upcoming"],
            ["health", "Health"],
            ["analysis", "Analysis"],
          ].map(([path, label]) => (
            <a
              key={path}
              href={`./admin-${path}-demo.html`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
