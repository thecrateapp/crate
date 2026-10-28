import { useState } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import inventory from "../../docs/plans/crate-v3-analysis/admin-icon-inventory-1v.json";
import review from "../../docs/plans/crate-v3-analysis/admin-icon-review-1v.json";
const labels: Record<string, string> = {
  "glyph-jsx": "Glifos en JSX",
  "glyph-reference": "Referencias en expresiones",
  "icon-prop": "Props de icono",
  "icon-property": "Mapas y propiedades",
  "dynamic-glyph": "Slots por revisar",
  "owned-icon-consumer": "Rutas a controles con iconos",
  "external-visual": "Gráficos y mapas",
};
const kinds: Record<string, string> = {
  replace: "Propuesta · texto o marcador",
  coordinate: "Contrato compartido pendiente",
  content: "Contenido · fuera de la retirada",
};
export function AdminIconCheckpoint() {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(8);
  const [sample, setSample] = useState("Sin acciones de muestra.");
  const files = inventory.files.filter(
    (file) =>
      Object.keys(file.counts).length &&
      file.path.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section
      id="iconos-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1V, Inventario de iconos de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="23">
            Checkpoint 1V · Publicado
          </MonoLabel>
          <h2>El texto lleva la acción.</h2>
        </div>
        <p>
          Inventario y propuesta de retirada. Las pantallas de Admin todavía
          conservan sus iconos.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-8">
        <StatNumber
          value={inventory.totals.filesScanned}
          label="Archivos examinados"
        />
        <StatNumber
          value={inventory.totals.filesWithGlyphImports}
          label="Archivos con imports de glifos"
        />
        <StatNumber
          value={review.proposedRetainedActionGlyphs}
          label="Excepciones de acción propuestas"
        />
      </div>
      <div className="mt-10 border-t border-border-quiet pt-6">
        <MonoLabel>
          Propuesta de lenguaje · componentes compartidos reales
        </MonoLabel>
        <div
          className="mt-4 flex flex-wrap items-center gap-3"
          role="group"
          aria-label="Acciones tipográficas de muestra"
        >
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setSample("Navegación de muestra abierta.")}
          >
            Navegación
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setSample("Volver a la muestra anterior.")}
          >
            Atrás
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setSample("Descarga de muestra solicitada.")}
          >
            Descargar
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setSample("Muestra cerrada.")}
          >
            Cerrar
          </Button>
          <StatusDot tone="on" label="Procesando" />
        </div>
        <p
          role="status"
          aria-label="Resultado de la muestra de texto"
          className="mt-4 text-sm text-text-muted"
        >
          {sample}
        </p>
        <p className="mt-4 text-sm text-text-muted">
          Estas acciones solo cambian este ejemplo. La integración de
          navegación, permisos y teclado se hará por grupos.
        </p>
      </div>
      <div className="mt-10 border-t border-border-quiet pt-6">
        <MonoLabel>Alcance del código</MonoLabel>
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          {Object.entries(inventory.totals.counts).map(([kind, count]) => (
            <div
              key={kind}
              className="flex justify-between gap-4 border-b border-border-quiet py-3 text-sm"
            >
              <dt>{labels[kind] ?? kind}</dt>
              <dd className="font-mono tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-text-muted">
          Son referencias estáticas que pueden solaparse. Una ruta a Button
          incluye su spinner condicional; no implica que esté visible. Los slots
          dinámicos necesitan revisión manual. Gráficos, mapas, marcas, QR y la
          presentación de Listen se evalúan como contenido.
        </p>
        <div className="crate-form-field mt-6">
          <label htmlFor="admin-icon-file-filter" className="text-sm">
            Filtrar archivos del inventario
          </label>
          <Input
            id="admin-icon-file-filter"
            value={filter}
            placeholder="Por ejemplo: layout/Sidebar"
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(8);
            }}
          />
        </div>
        <p
          role="status"
          aria-label="Archivos encontrados"
          className="mt-4 text-sm text-text-muted"
        >
          {files.length} {files.length === 1 ? "archivo" : "archivos"} con
          referencias · se muestran {Math.min(limit, files.length)}
        </p>
        <ul className="mt-4" aria-label="Archivos del inventario">
          {files.slice(0, limit).map((file) => (
            <li key={file.path} className="border-b border-border-quiet py-3">
              <details>
                <summary className="min-h-11 cursor-pointer break-all font-mono text-xs py-3">
                  {file.path.replace("app/ui/src/", "")}
                </summary>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 pb-4 text-sm">
                  {Object.entries(file.counts).map(([kind, count]) => (
                    <div key={kind} className="flex justify-between gap-4 py-1">
                      <dt>{labels[kind] ?? kind}</dt>
                      <dd>{count}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ul>
        {limit < files.length && (
          <Button
            className="mt-4 min-h-11"
            variant="ghost"
            onClick={() => setLimit(limit + 8)}
          >
            Mostrar 8 archivos más
          </Button>
        )}
      </div>
      <div className="mt-10 border-t border-border-quiet pt-6">
        <MonoLabel>Casos para revisar antes de migrar</MonoLabel>
        <p className="mt-4 text-sm text-text-muted">
          No se propone conservar ningún glifo de acción como excepción
          permanente. Cierres, reproducción y despliegues no tienen una exención
          general. Los siguientes casos fijan alternativas y dependencias.
        </p>
        <ul className="mt-4" aria-label="Propuestas por control">
          {review.cases.map((item) => (
            <li key={item.id} className="border-b border-border-quiet py-3">
              <details>
                <summary className="min-h-11 cursor-pointer py-3">
                  <span>{item.control}</span>{" "}
                  <span className="ml-3 text-xs text-text-muted">
                    {kinds[item.kind]}
                  </span>
                </summary>
                <p className="mt-2">{item.proposal}</p>
                <p className="mt-2 text-sm text-text-muted">{item.why}</p>
                <p className="mt-3 mb-4 break-all font-mono text-xs text-text-muted">
                  {item.path}:{item.line}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Tras aprobar 1V, Diego confirmó que se conservan los glifos funcionales
        de UX, como atrás/adelante y contraer/expandir. Ver el grupo 1W al final
        de la página.
      </p>
      <p className="mt-8 text-sm">
        Primer grupo propuesto: Sidebar, CommandPalette y Shell. Después,
        controles compartidos y familias de páginas, cada grupo con sus pruebas
        y revisión.
      </p>
      <p className="mt-4 text-sm text-text-muted">
        1V publicado: inventario aprobado. No se retiraron iconos de producción
        ni cambiaron contratos compartidos. Se conservan todos los checkpoints
        anteriores.
      </p>
    </section>
  );
}
