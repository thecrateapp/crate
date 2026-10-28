import { useState } from "react";
import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  OpsStatTile,
} from "../../app/ui/src/components/admin/ops-surfaces";
import { QueueLanes } from "../../app/ui/src/components/admin/QueueLanes";
import {
  GovernorGauges,
  type GovernorSurface,
} from "../../app/ui/src/components/admin/GovernorGauges";
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

const queueSample = {
  breakdown: {
    running: { maintenance: 1, default: 0, fast: 2, heavy: 1, playback: 0 },
    pending: { maintenance: 3, default: 1, fast: 0, heavy: 2, playback: 1 },
  },
  runningTasks: [
    { id: "task-1", type: "metadata_enrichment", pool: "maintenance" },
    { id: "task-2", type: "artist_refresh", pool: "fast" },
    { id: "task-3", type: "album_refresh", pool: "fast" },
    { id: "task-4", type: "audio_analysis", pool: "heavy" },
  ],
  pendingTasks: [
    { id: "task-5", type: "metadata_enrichment", pool: "maintenance" },
    { id: "task-6", type: "library_scan", pool: "maintenance" },
    { id: "task-7", type: "quality_check", pool: "maintenance" },
    { id: "task-8", type: "playlist_rebuild", pool: "default" },
    { id: "task-9", type: "bliss_analysis", pool: "heavy" },
    { id: "task-10", type: "bliss_analysis", pool: "heavy" },
    { id: "task-11", type: "playback_prepare", pool: "playback" },
  ],
  doneTasks: [
    {
      id: "task-12",
      type: "cover_fetch",
      pool: "maintenance",
      status: "completed",
    },
    { id: "task-13", type: "audio_analysis", pool: "heavy", status: "failed" },
    {
      id: "task-14",
      type: "stream_variant_prepare",
      pool: "playback",
      status: "completed",
    },
  ],
};

const governorSample: GovernorSurface = {
  available: true,
  stale: false,
  sampled_at: "2026-10-22T09:30:00+02:00",
  sampled_by: "crate-worker",
  enabled: true,
  allowed: true,
  defer_seconds: 300,
  gauges: [
    {
      id: "load_ratio",
      label: "Load ratio",
      value: 0.46,
      unit: "",
      limit: 0.85,
      scale: 1.2,
      over: false,
    },
    {
      id: "iowait_percent",
      label: "I/O wait",
      value: 6.2,
      unit: "%",
      limit: 25,
      scale: 40,
      over: false,
    },
    {
      id: "swap_used_percent",
      label: "Swap used",
      value: 18,
      unit: "%",
      limit: 30,
      scale: 60,
      over: false,
    },
    {
      id: "active_users",
      label: "Listeners",
      value: 4,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
    {
      id: "active_streams",
      label: "Streams",
      value: 3,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
  ],
  window: {
    enabled: true,
    start: "02:00",
    end: "07:00",
    in_window: false,
  },
};

type QueueDemoState = "queued" | "running" | "done";

const QUEUE_DEMO_STATES: QueueDemoState[] = ["queued", "running", "done"];

export function AdminOpsCheckpoint() {
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState(0);
  const [queueDemoState, setQueueDemoState] =
    useState<QueueDemoState>("queued");
  const queueDemoTask = {
    id: "queue-flow-demo",
    type: "process_new_content",
    pool: "default",
    status:
      queueDemoState === "queued"
        ? "pending"
        : queueDemoState === "done"
          ? "completed"
          : "running",
  };
  const queueBreakdown = {
    running: {
      ...queueSample.breakdown.running,
      default:
        queueSample.breakdown.running.default +
        (queueDemoState === "running" ? 1 : 0),
    },
    pending: {
      ...queueSample.breakdown.pending,
      default:
        queueSample.breakdown.pending.default +
        (queueDemoState === "queued" ? 1 : 0),
    },
  };
  const queuePendingTasks = [
    ...(queueDemoState === "queued" ? [queueDemoTask] : []),
    ...queueSample.pendingTasks,
  ];
  const queueRunningTasks = [
    ...(queueDemoState === "running" ? [queueDemoTask] : []),
    ...queueSample.runningTasks,
  ];
  const queueDoneTasks = [
    ...(queueDemoState === "done" ? [queueDemoTask] : []),
    ...queueSample.doneTasks,
  ];
  const advanceQueueDemo = () =>
    setQueueDemoState((current) => {
      const currentIndex = QUEUE_DEMO_STATES.indexOf(current);
      return QUEUE_DEMO_STATES[(currentIndex + 1) % QUEUE_DEMO_STATES.length]!;
    });
  return (
    <section
      id="superficies-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1Y, Superficies operativas de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="26">
            Checkpoint 1Y · Publicado
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
          description="Cada carril separa tareas activas y pendientes por pool, con los datos que llegan en el snapshot operativo."
          action={
            <Button
              variant="outline"
              size="sm"
              aria-label={`Advance sample task from ${queueDemoState}`}
              onClick={advanceQueueDemo}
            >
              Advance sample task
            </Button>
          }
        >
          <QueueLanes
            breakdown={queueBreakdown}
            runningTasks={queueRunningTasks}
            pendingTasks={queuePendingTasks}
            doneTasks={queueDoneTasks}
            taskTypeCount={125}
          />
          <div className="mt-4" data-testid="ops-governor">
            <GovernorGauges surface={governorSample} />
          </div>
          <a
            href="#controles-admin"
            className="mt-4 inline-flex min-h-11 items-center text-sm underline"
          >
            Revisar controles de Admin
          </a>
        </OpsPanel>
        <section
          data-testid="ops-freshness"
          aria-label="Freshness and recovery states"
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MonoLabel as="h3">Freshness and recovery</MonoLabel>
            <OpsSnapshotStatus
              snapshot={{ stale: false, built_at: "2026-10-22T09:30:00Z" }}
              streamStatus="live"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border-quiet bg-raised-surface p-4">
              <MonoLabel as="div">Last known good snapshot</MonoLabel>
              <div className="mt-3 flex flex-wrap gap-2">
                <OpsSnapshotStatus
                  snapshot={{ stale: true, built_at: "2026-10-22T08:30:00Z" }}
                  streamStatus="reconnecting"
                />
              </div>
              <p className="mt-3 text-sm text-text-muted">
                The stream can recover while the last snapshot remains visible.
              </p>
            </div>
            <OpsRefreshNotice
              message="Could not refresh worker logs. Showing the last successful snapshot."
              onRetry={() => setUpdates((value) => value + 1)}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
