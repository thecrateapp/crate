import { useState } from "react";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { Table, TableBody, TableRow, TableCell } from "@crate/ui/shadcn/table";
import { CrateChip } from "@crate/ui/primitives/CrateBadge";
export function RowInteractionSample() {
  const [opened, setOpened] = useState(0);
  return (
    <section
      aria-label="Filas compartidas sin iluminación"
      className="grid gap-4 border-t border-border-quiet pt-6"
    >
      <h2 className="font-display text-2xl">Filas compartidas</h2>
      <p className="text-sm text-text-muted">
        Muestras reales de las bases de filas. El fondo se mantiene al pasar el
        puntero; selección, estado activo y foco conservan su señal.
      </p>
      <EntityRow
        title="Entidad de muestra"
        openLabel="Entidad de muestra"
        subtitle="Componente compartido"
        onOpen={() => setOpened((n) => n + 1)}
        disableItemActionTarget
      />
      <EntityRow
        title="Entidad seleccionada"
        openLabel="Entidad seleccionada"
        selected
        onOpen={() => setOpened((n) => n + 1)}
        disableItemActionTarget
      />
      <HairlineList label="Lista de muestra">
        <HairlineRow asChild>
          <button type="button" onClick={() => setOpened((n) => n + 1)}>
            Fila de lista
          </button>
        </HairlineRow>
        <HairlineRow active>Fila activa</HairlineRow>
      </HairlineList>
      <Table className="crate-track-table">
        <TableBody>
          <TableRow>
            <TableCell>Fila de tabla</TableCell>
          </TableRow>
          <TableRow data-state="selected">
            <TableCell>Fila de tabla seleccionada</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p role="status">Aperturas de muestra: {opened}</p>
      <div className="font-semibold leading-loose">
        <CrateChip>Etiqueta de muestra</CrateChip>
      </div>
    </section>
  );
}
