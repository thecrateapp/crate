import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminNavigationCheckpoint() {
  return (
    <section
      id="navegacion-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1W, Navegación de Admin por texto"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="24">
            Checkpoint 1W · Publicado
          </MonoLabel>
          <h2>Los destinos tienen nombre.</h2>
        </div>
        <p>
          Destinos y comandos por su nombre. Se conservan los glifos de
          atrás/adelante, contraer/expandir, menú, búsqueda y cierre.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Listen y Desktop conservan sus iconos y controles de
        reproducción. Este ejemplo monta los tres componentes reales con sesión
        y datos ficticios; no necesita backend.
      </p>
      <iframe
        title="Navegación real de Admin con datos de muestra"
        src="./admin-navigation-demo.html"
        className="mt-6 w-full h-[850px] border border-border-quiet"
      />
      <a
        href="./admin-navigation-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir la muestra de Admin en una pestaña
      </a>
      <p className="mt-4 text-sm text-text-muted">
        Puedes contraer la columna, cambiar de destino, probar la paleta o abrir
        la ayuda con ?. El avatar del encabezado agrupa la cuenta, el cierre de
        sesión y la vista previa de permisos junto a la búsqueda global. La
        preferencia de anchura se guarda como en Admin.
      </p>
    </section>
  );
}
