import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { useSyncExternalStore } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { PlaylistEditor } from "../../../app/ui/src/pages/PlaylistEditor";
import { Playlists } from "../../../app/ui/src/pages/Playlists";
import {
  complete,
  pushStream,
  setFailure,
  setLLM,
  setSample,
  snapshot,
  subscribe,
  type Sample,
} from "../../design-system-preview/admin-playlist-editor-fixtures";

function PageControls() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useSyncExternalStore(subscribe, snapshot);
  const page = location.pathname === "/playlists" ? "list" : "editor";

  return (
    <header
      data-admin-review-controls="playlists"
      className="grid min-w-0 gap-4 border-b border-border-quiet pb-5"
    >
      <p className="m-0 text-sm text-text-muted">
        Playlists and editor real de Admin · datos ficticios. Lecturas, streams
        y acciones locales; no necesita backend ni modifica la biblioteca.
      </p>
      <FormField kind="group" label="Página de revisión" className="min-w-0">
        <SegmentedControl
          as="radio"
          label="Página de revisión"
          className="min-w-0"
          value={page}
          onValueChange={(value) =>
            navigate(value === "list" ? "/playlists" : "/playlists/42")
          }
          items={[
            { value: "list", label: "Playlists" },
            { value: "editor", label: "Editor" },
          ]}
        />
      </FormField>
      {page === "editor" ? (
        <>
          <FormField kind="group" label="Estado de muestra" className="min-w-0">
            <SegmentedControl
              as="radio"
              label="Estado de muestra"
              className="min-w-0"
              value={state.sample}
              onValueChange={(value) => setSample(value as Sample)}
              items={[
                { value: "smart", label: "Smart", disabled: state.pending },
                {
                  value: "static",
                  label: "Estática",
                  disabled: state.pending,
                },
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
                  label: "Fallida",
                  disabled: state.pending,
                },
              ]}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={!state.pending}
              onClick={complete}
            >
              Completar acción de muestra
            </Button>
            <Button
              variant="outline"
              disabled={state.pending || state.sample === "missing"}
              onClick={pushStream}
            >
              Enviar cambio SSE
            </Button>
            <FormField
              layout="inline"
              label="Fallar la siguiente acción"
              className="min-w-0"
            >
              <Checkbox
                checked={state.failNext}
                disabled={state.pending}
                onCheckedChange={(checked) => setFailure(checked === true)}
              />
            </FormField>
            <FormField
              layout="inline"
              label="IA disponible"
              className="min-w-0"
            >
              <Checkbox
                checked={state.llm}
                disabled={state.pending}
                onCheckedChange={(checked) => setLLM(checked === true)}
              />
            </FormField>
          </div>
          <p role="status" className="m-0 break-all font-mono text-xs">
            {state.action}
          </p>
        </>
      ) : null}
    </header>
  );
}

export function AdminPlaylistsReview({
  initialPage = "editor",
}: {
  initialPage?: "list" | "editor";
}) {
  const { sample } = useSyncExternalStore(subscribe, snapshot);
  const initialEntries =
    initialPage === "list" ? ["/playlists"] : ["/playlists", "/playlists/42"];

  return (
    <MemoryRouter
      initialEntries={initialEntries}
      initialIndex={initialEntries.length - 1}
    >
      <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
        <PageControls />
        <Routes>
          <Route
            path="/playlists"
            element={
              <section
                aria-label="Página real de System Playlists"
                className="min-w-0"
              >
                <Playlists />
              </section>
            }
          />
          <Route
            path="/playlists/:playlistId"
            element={
              <section
                aria-label="Página real de PlaylistEditor"
                className="min-w-0"
              >
                <PlaylistEditor key={sample} />
              </section>
            }
          />
        </Routes>
        <Toaster {...toasterConfig} />
      </main>
    </MemoryRouter>
  );
}
