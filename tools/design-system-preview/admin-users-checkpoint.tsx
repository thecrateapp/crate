import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminUsersCheckpoint() {
  return (
    <section
      id="usuarios-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AM, Users de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="37">
            Checkpoint 1AM · Publicado
          </MonoLabel>
          <h2>Usuarios, de un vistazo.</h2>
        </div>
        <p>
          Identidad, estado y presencia en cada fila. El detalle y las acciones
          permanecen en su modal, con datos disponibles reales.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Página real con datos ficticios. Mapa retirado; conserva filtros,
        paginación, permisos y acciones. Los cambios se completan manualmente y
        son locales a esta muestra.
      </p>
      <iframe
        title="Users real con datos de muestra"
        src="./admin-users-demo.html"
        className="mt-6 h-[1200px] w-full border border-border-quiet"
      />
      <a
        href="./admin-users-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Users en una pestaña
      </a>
    </section>
  );
}
