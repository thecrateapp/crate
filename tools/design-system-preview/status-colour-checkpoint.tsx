import { useState } from "react";

import { OpsStatTile } from "../../app/ui/src/components/admin/ops-surfaces";
import { SeverityMeter } from "../../app/ui/src/components/admin/status-indicators";
import { IssueList } from "../../app/ui/src/components/scanner/IssueList";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { Button } from "@crate/ui/shadcn/button";
const states = {
  on: { label: "Activo", tone: "on" },
  waiting: { label: "En espera", tone: "warn" },
  failed: { label: "Fallido", tone: "warn" },
  off: { label: "Sin actividad", tone: "off" },
} as const;
export function StatusColourCheckpoint() {
  const [state, setState] = useState<keyof typeof states>("failed");
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("Sin acciones de muestra.");
  return (
    <section
      id="estado-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1T, Colores de estado de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="21">
            Checkpoint 1T · Publicado
          </MonoLabel>
          <h2>El estado se lee.</h2>
        </div>
        <p>
          Una identidad: activo en acento, espera y fallo en ámbar, riesgo y
          nivel en gris. Siempre con palabras.
        </p>
      </div>
      <div
        className="grid grid-cols-1 gap-6 sm:grid-cols-3 mt-8"
        aria-label="Indicadores reales de Admin"
      >
        <OpsStatTile
          label="En servicio"
          value="7/8"
          caption="Servicios activos"
          tone="success"
        />
        <OpsStatTile
          label="Trabajos fallidos"
          value="1"
          caption="Fallo de muestra; conserva el contexto"
          tone="danger"
        />
        <OpsStatTile
          label="Pendientes"
          value="3"
          caption="Esperando confirmación"
          tone="warning"
        />
      </div>
      <div className="crate-form-field max-w-xl mt-8">
        <MonoLabel as="div">Estado de muestra</MonoLabel>
        <SegmentedControl
          as="radio"
          label="Estado de muestra"
          value={state}
          onValueChange={(value) => setState(value as keyof typeof states)}
          items={Object.entries(states).map(([value, entry]) => ({
            value,
            label: entry.label,
          }))}
        />
      </div>
      <div className="mt-5" role="status" aria-label="Estado seleccionado">
        <StatusDot tone={states[state].tone} label={states[state].label} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-10">
        <figure className="m-0" aria-label="Riesgo en gris">
          <figcaption>
            <MonoLabel>Riesgo · componente real</MonoLabel>
          </figcaption>
          <div className="flex flex-wrap gap-6 mt-5">
            <SeverityMeter level="safe" label="Bajo" />
            <SeverityMeter level="caution" label="Revisión" />
            <SeverityMeter level="destructive" label="Alto" />
          </div>
        </figure>
        <figure className="m-0" aria-label="Niveles de log en gris">
          <figcaption>
            <MonoLabel>Nivel de log · componente real</MonoLabel>
          </figcaption>
          <div className="flex flex-wrap gap-6 mt-5">
            {["debug", "info", "warn", "error"].map((level) => (
              <SeverityMeter key={level} level={level} label={level} />
            ))}
          </div>
        </figure>
      </div>
      <figure className="m-0 mt-10" aria-label="Incidencia real de Admin">
        <figcaption className="mb-5">
          <MonoLabel>Lista de incidencias · componente real</MonoLabel>
        </figcaption>
        <IssueList
          issues={[
            {
              type: "servicio",
              severity: "critical",
              confidence: 100,
              description: "Servicio sin respuesta",
              suggestion: "Revisa la conexión antes de reintentar.",
              paths: [],
              details: {},
            },
          ]}
        />
      </figure>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Revisar acción de muestra
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={() => {
          setOutcome(
            "Cola de muestra vaciada. No se ha modificado la biblioteca.",
          );
          setOpen(false);
        }}
        variant="destructive"
        title="Vaciar cola de muestra"
        description="Esta acción solo cambia el texto de la muestra."
        eyebrow="Confirmar acción"
        consequence="Acción ficticia, sin peticiones al servidor"
        confirmLabel="Vaciar muestra"
        cancelLabel="Cancelar"
        closeLabel="Cerrar"
      />
      <div className="crate-form-field mt-8">
        <MonoLabel as="div" id="status-outcome-label">
          Resultado de la muestra
        </MonoLabel>
        <output
          role="status"
          aria-labelledby="status-outcome-label"
          className="text-sm text-text-muted"
        >
          {outcome}
        </output>
      </div>
      <p className="mt-8 text-sm text-text-muted">
        Datos ficticios y componentes de producción. Sin API ni preferencias
        guardadas. Los iconos existentes de Admin conservan su revisión prevista
        en 1b.8.
      </p>
    </section>
  );
}
