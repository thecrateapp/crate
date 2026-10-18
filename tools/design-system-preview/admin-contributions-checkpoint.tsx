import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminContributionsCheckpoint() {
  return (
    <section
      id="aportes-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AF, Contributions de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="32">
            Checkpoint 1AF · Publicado
          </MonoLabel>
          <h2>Qué se ha aportado y quién lo trajo.</h2>
        </div>
        <p>
          Contributions sin iconos redundantes. Álbum, procedencia, estado y
          autor conservan sus datos; carga y actualización mantienen sus
          indicadores funcionales.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con aportes ficticios y lecturas locales. Prueba
        Refresh, completa la lectura y sigue un enlace de álbum. La muestra no
        consulta un backend; sus destinos están señalados.
      </p>
      <iframe
        title="Contributions real con aportes de muestra"
        src="./admin-contributions-demo.html"
        className="mt-6 h-[1150px] w-full border border-border-quiet"
      />
      <a
        href="./admin-contributions-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Contributions en una pestaña
      </a>
    </section>
  );
}
