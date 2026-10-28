import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminTimelineRetirementCheckpoint() {
  return (
    <section
      id="cronologia-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AG, retirada de Timeline de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="32">
            Checkpoint 1AG · Publicado
          </MonoLabel>
          <h2>Timeline retirada.</h2>
        </div>
        <p>
          La cronología de la biblioteca se elimina de Admin por decisión de
          Diego. Su destino desaparece de la navegación; los enlaces antiguos
          llevan a Browse.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Se conserva este registro del checkpoint. El boceto anterior queda
        archivado; esta sección ya no monta una página Timeline ni solicita sus
        datos.
      </p>
      <a
        href="./admin-navigation-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Revisar la navegación de Admin
      </a>
    </section>
  );
}
