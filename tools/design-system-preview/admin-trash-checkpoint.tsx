import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function AdminTrashCheckpoint() {
  return (
    <section
      id="papelera-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AE, Library Trash de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="32">
            Checkpoint 1AE · Publicado
          </MonoLabel>
          <h2>Restaurar o eliminar, por su nombre.</h2>
        </div>
        <p>
          Library Trash con acciones de texto. Se conservan carga, bloqueos,
          seguimiento de tareas y las dos confirmaciones compartidas.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Solo Admin. Página real con pistas ficticias y tareas locales; ningún
        botón modifica una biblioteca. Prueba la restauración, la eliminación
        individual, el vaciado, sus cancelaciones y un fallo de tarea.
      </p>
      <iframe
        title="Library Trash real con pistas de muestra"
        src="./admin-trash-demo.html"
        className="mt-6 h-[1000px] w-full border border-border-quiet"
      />
      <a
        href="./admin-trash-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir Library Trash en una pestaña
      </a>
    </section>
  );
}
