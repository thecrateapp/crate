import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminRolesCheckpoint() {
  return (
    <section
      id="roles-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AL, Roles de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="36">
            Checkpoint 1AL · Publicado
          </MonoLabel>
          <h2>Roles, sin adornos.</h2>
        </div>
        <p>
          Roles y capacidades por su nombre. Catálogo de solo lectura con las
          fuentes y el espaciado de V3.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con datos ficticios y lectura pendiente manual.
        Conserva el orden, agrupación y conteo de la respuesta; no cambia roles
        ni permisos.
      </p>
      <iframe
        title="Roles real con datos de muestra"
        src="./admin-roles-demo.html"
        className="mt-6 h-[1100px] w-full border border-border-quiet"
      />
      <a
        href="./admin-roles-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Roles en una pestaña
      </a>
    </section>
  );
}
