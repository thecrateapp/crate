import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Link,
  Routes,
  Route,
  useLocation,
  useParams,
} from "react-router";
import { PlaylistEditor } from "../../app/ui/src/pages/PlaylistEditor";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import {
  subscribe,
  snapshot,
  setSample,
  setFailure,
  complete,
  setLLM,
  pushStream,
} from "./admin-playlist-editor-fixtures";
import "./admin-navigation-demo.css";
function Destination() {
  const location = useLocation();
  return (
    <section className="grid gap-4">
      <h1 className="font-display text-3xl">Destino de muestra</h1>
      <p className="font-mono">{location.pathname}</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/playlists/42"
      >
        Volver al editor de muestra
      </Link>
    </section>
  );
}
function Editor() {
  const { playlistId } = useParams();
  return playlistId === "42" ? (
    <section aria-label="Página real de PlaylistEditor">
      <PlaylistEditor />
    </section>
  ) : (
    <Destination />
  );
}
function Demo() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return (
    <MemoryRouter initialEntries={["/playlists/42"]}>
      <main className="grid min-w-0 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            PlaylistEditor real de Admin · datos ficticios. Lecturas, SSE y
            acciones locales; no necesita backend ni modifica tu biblioteca.
          </p>
          <div className="crate-form-field">
            <MonoLabel as="span">Estado de muestra</MonoLabel>
            <SegmentedControl
              as="radio"
              label="Estado de muestra"
              value={state.sample}
              onValueChange={setSample}
              items={[
                { value: "smart", label: "Smart", disabled: state.pending },
                { value: "static", label: "Estática", disabled: state.pending },
                {
                  value: "loading",
                  label: "Cargando",
                  disabled: state.pending,
                },
                {
                  value: "missing",
                  label: "No encontrada",
                  disabled: state.pending,
                },
                {
                  value: "failed",
                  label: "Generación fallida",
                  disabled: state.pending,
                },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!state.pending}
              onClick={complete}
            >
              Completar acción o lectura de muestra
            </Button>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={state.pending || state.sample === "missing"}
              onClick={pushStream}
            >
              Enviar cambio SSE de muestra
            </Button>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={state.failNext}
                disabled={state.pending}
                onChange={(e) => setFailure(e.target.checked)}
              />
              Fallar la siguiente acción
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={state.llm}
                disabled={state.pending}
                onChange={(e) => setLLM(e.target.checked)}
              />
              IA disponible en muestra
            </label>
          </div>
          <p role="status" className="break-all font-mono text-xs">
            {state.action}
          </p>
        </header>
        <Routes>
          <Route
            path="/playlists/:playlistId"
            element={<Editor key={state.sample} />}
          />
          <Route path="*" element={<Destination />} />
        </Routes>
        <Toaster {...toasterConfig} />
      </main>
    </MemoryRouter>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
createRoot(document.getElementById("root")!).render(<Demo />);
