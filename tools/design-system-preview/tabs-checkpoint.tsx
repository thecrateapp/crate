import { BrowserRouter, Link, useLocation, useNavigate } from "react-router";
import { useTabParam as useAdminTabParam } from "../../app/ui/src/hooks/use-tab-param";
import { useTabParam as useListenTabParam } from "../../app/listen/src/hooks/use-tab-param";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";

const panels = ["overview", "albums", "shows", "history"] as const;
const labels = ["Resumen", "Discografía", "Conciertos", "Historial"];
const descriptions = [
  "La vista general del artista, con datos de muestra.",
  "Los álbumes del artista, con datos de muestra.",
  "Los próximos conciertos, con datos de muestra.",
  "El historial de actividad, con datos de muestra.",
];

function TabsSamples() {
  const [adminTab, setAdminTab] = useAdminTabParam(panels, "overview");
  const [listenTab, setListenTab] = useListenTabParam(panels, "overview", {
    param: "listenTab",
  });
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <div className="grid min-w-0 items-start gap-10 lg:grid-cols-2">
        {[
          { name: "Admin", value: adminTab, change: setAdminTab, param: "tab" },
          {
            name: "Listen",
            value: listenTab,
            change: setListenTab,
            param: "listenTab",
          },
        ].map(({ name, value, change, param }) => (
          <InstrumentPanel key={name} label={{ children: name }}>
            <p className="admin-baseline-note mb-5">
              Helper real de {name} · ?{param}=
            </p>
            <Tabs value={value} onValueChange={change}>
              <TabsList aria-label={`Paneles de ${name}`}>
                {panels.map((panel, index) => (
                  <TabsTrigger key={panel} value={panel}>
                    {labels[index]}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="unavailable" disabled>
                  Próximamente
                </TabsTrigger>
              </TabsList>
              {panels.map((panel, index) => (
                <TabsContent key={panel} value={panel}>
                  <p className="admin-baseline-note">{descriptions[index]}</p>
                </TabsContent>
              ))}
            </Tabs>
          </InstrumentPanel>
        ))}
      </div>
      <div className="mt-8 space-y-5">
        <div className="crate-form-field">
          <MonoLabel as="div" id="tabs-sample-url">
            URL de muestra
          </MonoLabel>
          <output
            aria-labelledby="tabs-sample-url"
            className="block break-all font-mono text-label text-text-secondary"
          >
            {location.pathname}
            {location.search}
            {location.hash}
          </output>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Anterior
          </Button>
          <Button variant="ghost" onClick={() => navigate(1)}>
            Siguiente
          </Button>
          <Button variant="ghost" asChild>
            <Link
              to="?tab=shows&listenTab=albums&node=muestra#pestanas"
              preventScrollReset
            >
              Probar enlace directo
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link
              to="?tab=unknown&listenTab=unknown&node=muestra#pestanas"
              preventScrollReset
            >
              Probar valor desconocido
            </Link>
          </Button>
        </div>
        <p className="admin-baseline-note">
          Flechas para cambiar de panel; Inicio y Fin para recorrer la fila. Los
          enlaces y el historial cambian solo esta muestra. No hay peticiones ni
          guardados.
        </p>
      </div>
    </>
  );
}

export function TabsCheckpoint() {
  return (
    <section
      id="pestanas"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1Q, Pestañas"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="18">
            Checkpoint 1Q · En revisión
          </MonoLabel>
          <h2>Paneles con una dirección.</h2>
        </div>
        <p>
          Una misma pestaña de texto en ambas aplicaciones. El subrayado indica
          el panel activo; la dirección conserva la selección.
        </p>
      </div>
      <BrowserRouter>
        <TabsSamples />
      </BrowserRouter>
    </section>
  );
}
