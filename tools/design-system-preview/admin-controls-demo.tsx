import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter, useLocation } from "react-router";
import { SearchBar } from "../../app/ui/src/components/layout/SearchBar";
import { AIButton } from "../../app/ui/src/components/ui/AIButton";
import { AdminSelect } from "../../app/ui/src/components/ui/AdminSelect";
import { LLMStatusProvider } from "../../app/ui/src/hooks/use-llm";
import { Button } from "@crate/ui/shadcn/button";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { completeSearch, setLlmAvailable } from "./admin-navigation-fixtures";
import "./admin-navigation-demo.css";
function Demo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  const [source, setSource] = useState("all");
  const route = useLocation();
  return (
    <main className="grid gap-8 p-8">
      <header>
        <h1 className="font-display text-3xl">Controles de Admin</h1>
        <p className="mt-3 text-sm text-text-muted">
          Componentes reales. Biblioteca y operaciones ficticias.
        </p>
      </header>
      <section aria-label="Búsqueda de muestra" className="grid min-w-0 gap-4">
        <h2 className="font-mono text-xs uppercase tracking-wider">
          Buscar en la biblioteca
        </h2>
        <p className="text-sm text-text-muted">
          Busca «costa» para ver resultados, «vacio» para el estado vacío o
          «espera» para mantener la carga.
        </p>
        <Button
          variant="outline"
          className="min-h-11 justify-self-start"
          onClick={completeSearch}
        >
          Completar carga de búsqueda
        </Button>
        <div className="min-w-0 max-w-[500px] [&>div]:w-full">
          <SearchBar inputRef={inputRef} />
        </div>
        <output
          aria-label="Destino de muestra"
          className="font-mono text-xs break-all"
        >
          {route.pathname}
        </output>
      </section>
      <section aria-label="Asistencia de muestra" className="grid gap-4">
        <h2 className="font-mono text-xs uppercase tracking-wider">
          Asistencia
        </h2>
        <FormField layout="inline" label="Servicio de IA disponible">
          <Checkbox
            checked={available}
            onCheckedChange={(checked) => {
              setLlmAvailable(checked === true);
              setAvailable(checked === true);
            }}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-4">
          <LLMStatusProvider key={String(available)}>
            <AIButton loading={busy} onClick={() => setBusy(true)}>
              Investigar con IA
            </AIButton>
          </LLMStatusProvider>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setBusy(false)}
          >
            Terminar muestra de IA
          </Button>
        </div>
        <p role="status" className="text-sm text-text-muted">
          {busy
            ? "Investigación ficticia en curso."
            : "Sin investigación en curso."}
        </p>
      </section>
      <section aria-label="Selector compartido" className="crate-form-field">
        <span data-slot="form-field-label" className="text-sm text-text-muted">
          Fuente de muestra
        </span>
        <AdminSelect
          placeholder="Fuente de muestra"
          value={source}
          onChange={setSource}
          allowClear={false}
          options={[
            { value: "all", label: "Toda la biblioteca" },
            { value: "local", label: "Solo local" },
            { value: "external", label: "Externa" },
          ]}
          triggerClassName="min-h-11 w-full max-w-none"
        />
        <output aria-label="Fuente seleccionada" className="font-mono text-xs">
          {source}
        </output>
      </section>
    </main>
  );
}
applyCrateIdentity();
const dispose = installFocusRingMotion();
if (import.meta.hot) import.meta.hot.dispose(dispose);
flushSync(() =>
  createRoot(document.getElementById("root")!).render(
    <MemoryRouter>
      <Demo />
    </MemoryRouter>,
  ),
);
