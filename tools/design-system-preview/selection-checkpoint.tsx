import { useState } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  CrateForm,
  EMPTY_CRATE_FORM_VALUES,
} from "../../app/listen/src/components/crates/CrateForm";
import { PlaybackModeSelect } from "../../app/listen/src/components/jam/JamRoomCreateOptions";
import { PlayerSurfaceModeSwitch } from "../../app/listen/src/components/player/PlayerSurfaceModeSwitch";
import type { PlayerSurfaceMode } from "../../app/listen/src/lib/player-visualizer-prefs";
import type { JamQueueMode } from "../../app/listen/src/pages/jam-reducer";
import spanish from "../../app/listen/src/i18n/catalogs/es.json";

const sampleI18n = createInstance();
void sampleI18n.init({
  initAsync: false,
  lng: "es",
  fallbackLng: "es",
  keySeparator: false,
  resources: { es: { translation: spanish } },
  interpolation: { escapeValue: false },
});

export function SelectionCheckpoint() {
  const [taskState, setTaskState] = useState("");
  const [crate, setCrate] = useState({
    ...EMPTY_CRATE_FORM_VALUES,
    name: "Crate de muestra",
  });
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState("Formulario de muestra sin guardar.");
  const [queueMode, setQueueMode] = useState<JamQueueMode>("manual");
  const [permanent, setPermanent] = useState(false);
  const [surface, setSurface] = useState<PlayerSurfaceMode>("cover");

  return (
    <I18nextProvider i18n={sampleI18n}>
      <section
        id="seleccion"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1P, Selección"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="17">
              Checkpoint 1P · En revisión
            </MonoLabel>
            <h2>Las opciones cortas, a la vista.</h2>
          </div>
          <p>
            Los filtros y los formularios comparten chips. Las listas largas y
            dinámicas conservan su desplegable.
          </p>
        </div>
        <div className="grid min-w-0 items-start gap-10 lg:grid-cols-2">
          <div className="min-w-0 space-y-10">
            <InstrumentPanel label={{ children: "Filtros de Admin" }}>
              <div className="crate-form-field">
                <MonoLabel>Estado de muestra</MonoLabel>
                <SegmentedControl
                  as="radio"
                  label="Estado de muestra"
                  value={taskState}
                  onValueChange={setTaskState}
                  items={[
                    { value: "", label: "Todos" },
                    { value: "attention", label: "Pendientes" },
                    { value: "completed", label: "Completadas" },
                    { value: "failed", label: "Fallidas" },
                    { value: "cancelled", label: "Canceladas" },
                  ]}
                />
                <p className="admin-baseline-note">
                  Filtro de muestra: {taskState || "Todos"}
                </p>
              </div>
            </InstrumentPanel>
            <InstrumentPanel label={{ children: "Sala de Jam" }}>
              <PlaybackModeSelect
                roomQueueMode={queueMode}
                onRoomQueueModeChange={setQueueMode}
                setRoomPermanent={setPermanent}
              />
              <p className="admin-baseline-note mt-5">
                Sala permanente: {permanent ? "sí" : "no"}
              </p>
            </InstrumentPanel>
            <InstrumentPanel label={{ children: "Vista del reproductor" }}>
              <PlayerSurfaceModeSwitch mode={surface} onChange={setSurface} />
              <p className="admin-baseline-note mt-5">
                Vista de muestra: {surface}
              </p>
            </InstrumentPanel>
          </div>
          <InstrumentPanel label={{ children: "Formulario de Crate" }}>
            <CrateForm
              id="checkpoint-crate-form"
              values={crate}
              isOwner
              disabled={locked}
              onChange={(patch) =>
                setCrate((current) => ({ ...current, ...patch }))
              }
              onSubmit={(event) => {
                event.preventDefault();
                setStatus("Formulario de Crate de muestra guardado.");
              }}
            />
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="submit"
                form="checkpoint-crate-form"
                disabled={locked}
              >
                Guardar Crate de muestra
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLocked((current) => !current)}
              >
                {locked ? "Desbloquear" : "Bloquear"} formulario de muestra
              </Button>
            </div>
            <p role="status" className="admin-baseline-note mt-5">
              {status}
            </p>
          </InstrumentPanel>
        </div>
        <p className="admin-baseline-note mt-5">
          Componentes reales, valores de muestra. La biblioteca y las
          preferencias guardadas no se modifican. Radio espera 300 ms desde la
          última pulsación antes de consultar; ese comportamiento se verifica en
          su controlador.
        </p>
      </section>
    </I18nextProvider>
  );
}
