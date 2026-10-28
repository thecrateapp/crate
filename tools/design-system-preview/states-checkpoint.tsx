import { useState } from "react";
import { MemoryRouter } from "react-router";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { CardSkeleton } from "@crate/ui/composites/CardSkeleton";
import { TableSkeleton } from "@crate/ui/composites/TableSkeleton";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { Button } from "@crate/ui/shadcn/button";

const modes = [
  { value: "loading", label: "Cargando" },
  { value: "warming", label: "Construyendo" },
  { value: "ready", label: "Listo" },
  { value: "stale", label: "Desactualizado" },
  { value: "error", label: "Error" },
  { value: "empty", label: "Vacío" },
  { value: "offline", label: "Sin conexión" },
];

export function StatesCheckpoint() {
  const [mode, setMode] = useState("loading");
  const [hasData, setHasData] = useState(false);
  const [routeKey, setRouteKey] = useState(0);
  const [outcome, setOutcome] = useState("Sin acciones en la muestra.");
  function changeMode(value: string) {
    setMode(value);
    if (value === "ready") setHasData(true);
    if (value === "warming" || value === "empty") setHasData(false);
  }
  const status = modes.find(({ value }) => value === mode)!.label;
  const retain = hasData && !["warming", "empty"].includes(mode);

  const readings = (
    <div className="grid grid-cols-2 gap-4" aria-label="Valores de muestra">
      <div className="crate-form-field">
        <MonoLabel>Álbumes</MonoLabel>
        <StatNumber value={retain ? 124 : "—"} size="lg" />
      </div>
      <div className="crate-form-field">
        <MonoLabel>Pistas</MonoLabel>
        <StatNumber value={retain ? 1430 : "—"} size="lg" />
      </div>
    </div>
  );

  return (
    <section
      id="estados"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1R, Estados"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="19">
            Checkpoint 1R · En revisión
          </MonoLabel>
          <h2>El espacio se conserva.</h2>
        </div>
        <p>
          Sin giros ni destellos. La carga reserva las lecturas; un fallo
          conserva los últimos datos y permite reintentar.
        </p>
      </div>
      <div className="crate-form-field mb-8">
        <MonoLabel>Estado de la muestra</MonoLabel>
        <SegmentedControl
          as="radio"
          label="Estado de la muestra"
          value={mode}
          onValueChange={changeMode}
          items={modes}
        />
      </div>
      <div className="grid min-w-0 items-start gap-10 lg:grid-cols-2">
        <InstrumentPanel
          label={{ children: "Lecturas compartidas" }}
          summary="Instrumento de muestra"
          status={
            !["loading", "empty"].includes(mode) ? (
              <span className="inline-flex items-center gap-2">
                <StatusDot
                  tone={
                    mode === "ready"
                      ? "on"
                      : ["warming", "stale", "error"].includes(mode)
                        ? "warn"
                        : "off"
                  }
                  pulse={mode === "warming"}
                />
                {status}
              </span>
            ) : undefined
          }
        >
          <div className="state-preview-reserved">
            {mode === "empty" ? (
              <EmptyState
                title="Sin lecturas"
                description="Todavía no hay datos en esta muestra."
                action={
                  <Button variant="ghost" onClick={() => changeMode("loading")}>
                    Cargar muestra
                  </Button>
                }
              />
            ) : mode === "error" && !retain ? (
              <ErrorState
                title="No se pudo cargar"
                message="La muestra no tiene una lectura anterior."
                retryLabel="Reintentar"
                onRetry={() => changeMode("loading")}
              />
            ) : (
              <>
                {mode === "loading" ? (
                  <LoadingState label="Cargando lecturas">
                    {readings}
                  </LoadingState>
                ) : (
                  readings
                )}
                {mode === "loading" && retain ? (
                  <p className="admin-baseline-note">
                    Actualizando; se conserva la última lectura de muestra.
                  </p>
                ) : null}
                {mode === "warming" ? (
                  <p className="admin-baseline-note">
                    Esperando al proyector de muestra. No se inventan valores.
                  </p>
                ) : null}
                {mode === "stale" ? (
                  <p className="admin-baseline-note">
                    Última lectura de muestra · hace 4 min.
                  </p>
                ) : null}
                {mode === "error" && retain ? (
                  <ErrorState
                    title="No se pudo actualizar"
                    message="Se conserva la última lectura de muestra."
                    retryLabel="Reintentar"
                    onRetry={() => changeMode("loading")}
                  />
                ) : null}
                {mode === "offline" ? (
                  <>
                    <MonoLabel>Sin conexión</MonoLabel>
                    <Button variant="ghost" disabled>
                      Actualizar
                    </Button>
                    <p className="admin-baseline-note">
                      Conecta de nuevo para actualizar. Las lecturas disponibles
                      se conservan.
                    </p>
                  </>
                ) : null}
              </>
            )}
          </div>
        </InstrumentPanel>
        <InstrumentPanel
          label={{ children: "Carga de ruta · 200 ms" }}
          summary="Carga de ruta de muestra"
        >
          <div className="state-preview-route">
            <LoadingState
              key={routeKey}
              variant="route"
              label="Cargando ruta"
            />
          </div>
          <p className="admin-baseline-note mt-4">
            Indicador de 120 px. No aparece en cargas de menos de 200 ms.
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => setRouteKey((value) => value + 1)}
          >
            Reiniciar carga de ruta
          </Button>
          <div className="mt-8">
            <CardSkeleton label="Cargando resumen de muestra" />
          </div>
        </InstrumentPanel>
      </div>
      <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-2">
        <InstrumentPanel
          label={{ children: "Cuadrícula reservada" }}
          summary="Cuadrícula de muestra"
        >
          <GridSkeleton
            count={4}
            columns="grid-cols-2 sm:grid-cols-4"
            label="Cargando álbumes de muestra"
          />
          <p className="admin-baseline-note mt-5">
            Cubiertas cuadradas y dos líneas; conserva las columnas del
            consumidor.
          </p>

          <MonoLabel className="mt-6 mb-3">
            Artista · carga / tarjeta actual
          </MonoLabel>
          <div
            data-geometry="artist"
            className="grid grid-cols-2 items-start gap-4"
          >
            <GridSkeleton
              count={1}
              columns="grid-cols-1"
              variant="artist"
              label="Cargando artista de muestra"
            />
            <EntityCard
              title="Artista"
              subtitle="—"
              shape="circle"
              layout="grid"
              menuButton="none"
              className="mx-auto max-w-[calc(140px+2*var(--content-card-padding))]"
              artwork={<div className="size-full bg-surface-control" />}
            />
          </div>
          <MonoLabel className="mt-6 mb-3">
            Álbum · carga / tarjeta actual
          </MonoLabel>
          <div
            data-geometry="album"
            className="grid grid-cols-2 items-start gap-4"
          >
            <GridSkeleton
              count={1}
              columns="grid-cols-1"
              variant="album"
              label="Cargando álbum de muestra"
            />
            <EntityCard
              title="Álbum"
              subtitle="Artista"
              layout="grid"
              menuButton="none"
              artwork={<div className="size-full bg-surface-control" />}
            />
          </div>
        </InstrumentPanel>
        <InstrumentPanel
          label={{ children: "Filas reservadas" }}
          summary="Tabla de muestra"
        >
          <TableSkeleton
            rows={3}
            columns={3}
            label="Cargando pistas de muestra"
          />
          <div className="mt-5">
            <Skeleton data-testid="static-skeleton" className="h-4 w-32" />
          </div>
          <p className="admin-baseline-note mt-5">
            Tres filas de 44 px, cabecera de 32 px. Marcas estáticas, sin
            shimmer.
          </p>
        </InstrumentPanel>
      </div>
      <div className="mt-10">
        <MemoryRouter>
          <ErrorState
            variant="page"
            statusCode={503}
            eyebrow="Error de servicio"
            title="El servicio no está disponible"
            message="Error de muestra. Puedes reintentar o volver sin perder el contexto."
            retryLabel="Reintentar ejemplo"
            onRetry={() => setOutcome("Reintento de muestra solicitado.")}
            backTo="/muestra"
            backLabel="Volver a la muestra"
          />
        </MemoryRouter>
        <p
          role="status"
          aria-label="Resultado de la muestra"
          className="admin-baseline-note"
        >
          {outcome}
        </p>
      </div>
      <p className="admin-baseline-note mt-8">
        Datos ficticios y estados manuales. Los componentes de producción
        reciben estos estados del servidor; esta sección no hace peticiones ni
        guarda preferencias.
      </p>
    </section>
  );
}
