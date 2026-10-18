import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminAnalysisCheckpoint() {
  return (
    <section
      id="analisis-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AA, Analysis de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="28">
            Checkpoint 1AA · Publicado
          </MonoLabel>
          <h2>La cobertura se lee.</h2>
        </div>
        <p>
          Acciones, métricas y resultados de Analysis por su nombre. La carga
          conserva su glifo funcional.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página y componentes reales; snapshot y acciones ficticios,
        sin backend. Revisa las ocho acciones, el estado ocupado, las coberturas
        y los resultados recientes. Publicado como 13272706. La corrección
        tipográfica de 1AB está aplicada también a esta página real.
      </p>
      <iframe
        title="Analysis real con datos de muestra"
        src="./admin-analysis-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-analysis-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Analysis en una pestaña
      </a>
    </section>
  );
}
