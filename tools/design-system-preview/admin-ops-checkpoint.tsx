import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "../../app/ui/src/components/admin/ops-surfaces";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

const figures = [
  {
    label: "En servicio",
    value: "7/8",
    caption: "Servicios activos",
    tone: "success",
  },
  {
    label: "Trabajos fallidos",
    value: "1",
    caption: "Requiere revisión",
    tone: "danger",
  },
  {
    label: "Pendientes",
    value: "3",
    caption: "Esperando confirmación",
    tone: "warning",
  },
  {
    label: "Tareas en cola",
    value: "0",
    caption: "Sin trabajo pendiente",
    tone: "default",
  },
  {
    label: "Pistas analizadas",
    value: "48.000",
    caption: "Lectura de muestra",
    tone: "primary",
  },
  {
    label: "Tiempo medio de preparación",
    value: "120 ms",
    caption: "Etiqueta larga, lectura completa",
    tone: "default",
  },
] as const;
export function AdminOpsCheckpoint() {
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState(0);
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      id="superficies-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1Y, Superficies operativas de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="26">
            Checkpoint 1Y · En revisión
          </MonoLabel>
          <h2>El dato ocupa su sitio.</h2>
        </div>
        <p>
          Cabeceras, paneles y cifras por su nombre. La carga y el despliegue
          conservan sus glifos de UX.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Componentes reales de Admin, con datos ficticios y acciones locales.
        Este grupo retira los iconos de estas tres superficies; las acciones y
        filas específicas de cada página se revisarán después.
      </p>
      <div className="mt-8 grid gap-6">
        <div data-testid="ops-hero">
          <OpsPageHero
            title="Operaciones de muestra"
            description="Biblioteca, colas y servicios en una lectura compartida."
            actions={
              <>
                <Button
                  className="min-h-11"
                  variant="outline"
                  loading={busy}
                  onClick={() => setBusy(true)}
                >
                  Actualizar muestra
                </Button>
                {busy ? (
                  <Button
                    className="min-h-11"
                    variant="ghost"
                    onClick={() => {
                      setBusy(false);
                      setUpdates((value) => value + 1);
                    }}
                  >
                    Completar actualización
                  </Button>
                ) : null}
              </>
            }
          >
            <span role="status" className="text-xs text-text-muted">
              {updates
                ? `Muestra actualizada · ${updates}`
                : "Lectura de muestra disponible"}
            </span>
          </OpsPageHero>
        </div>
        <div
          data-testid="ops-stats"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {figures.map((figure) => (
            <div key={figure.label} data-sample-stat>
              <OpsStatTile {...figure} className="h-full" />
            </div>
          ))}
        </div>
        <OpsPanel
          title="Estado de las colas"
          description="Títulos y contenido completos. Los controles funcionales permanecen en su contexto."
          action={
            <Button
              variant="outline"
              className="min-h-11"
              aria-expanded={expanded}
              aria-controls="sample-queue-details"
              onClick={() => setExpanded((value) => !value)}
            >
              Detalles de las colas
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={expanded ? "rotate-180" : undefined}
              />
            </Button>
          }
        >
          <p className="text-sm text-text-muted">
            Las superficies no añaden iconos al título ni a las métricas.
          </p>
          <div
            id="sample-queue-details"
            role="region"
            aria-label="Detalle de colas de muestra"
            hidden={!expanded}
            className="mt-4 border-t border-border-quiet pt-4 text-sm"
          >
            Sin tareas en espera. El control de despliegue mantiene su glifo, su
            nombre y su teclado.
          </div>
          <a
            href="#controles-admin"
            className="mt-4 inline-flex min-h-11 items-center text-sm underline"
          >
            Revisar controles de Admin
          </a>
        </OpsPanel>
      </div>
    </section>
  );
}
