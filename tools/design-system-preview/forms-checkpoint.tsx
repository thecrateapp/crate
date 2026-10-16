import { useState } from "react";

import { AdminSelect } from "@crate/ui/composites/AdminSelect";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { Textarea } from "@crate/ui/shadcn/textarea";

const formats = [
  "FLAC",
  "ALAC",
  "WAV",
  "AIFF",
  "MP3",
  "AAC",
  "Ogg Vorbis",
  "Opus",
];
const formatOptions = formats.map((label, count) => ({
  label,
  value: label.toLowerCase(),
  count,
}));

export function FormsCheckpoint() {
  const [name, setName] = useState("Colección de pruebas");
  const [error, setError] = useState<string>();
  const [notes, setNotes] = useState("Carpetas y álbumes para esta muestra.");
  const [status, setStatus] = useState(
    "Ejemplo local. Tu biblioteca no se modifica.",
  );
  const [query, setQuery] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  const [keepQueue, setKeepQueue] = useState(true);
  const [order, setOrder] = useState("recent");
  const [format, setFormat] = useState("flac");
  const [adminFormat, setAdminFormat] = useState("flac");

  function validateName() {
    const nextError =
      name.trim().length < 2
        ? "Escribe al menos dos caracteres."
        : name.length > 40
          ? "El nombre admite hasta 40 caracteres."
          : undefined;
    setError(nextError);
    return !nextError;
  }

  return (
    <section
      id="formularios"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1O, Formularios"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="16">
            Checkpoint 1O · En revisión
          </MonoLabel>
          <h2>Formularios de una sola identidad.</h2>
        </div>
        <p>
          Campos, estados y selección con las mismas recetas en Listen y Admin.
        </p>
      </div>
      <div className="grid min-w-0 gap-10 lg:grid-cols-2">
        <InstrumentPanel label={{ children: "Campos y validación" }}>
          <form
            className="space-y-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (validateName()) setStatus("Formulario de muestra guardado.");
            }}
          >
            <FormField
              label="Nombre de la colección"
              hint="Entre 2 y 40 caracteres."
              error={error}
              required
            >
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={validateName}
              />
            </FormField>
            <FormField
              label="Notas de la colección"
              hint="La validación se muestra junto al campo."
            >
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
              />
            </FormField>
            <div
              data-slot="card"
              className="space-y-5 rounded-panel border border-border-quiet bg-surface-object p-5"
            >
              <MonoLabel>La misma receta sobre un panel</MonoLabel>
              <FormField
                label="Identificador de la muestra"
                hint="Campo de solo lectura."
              >
                <Input value="crate-demo-01" readOnly />
              </FormField>
              <FormField label="Campo desactivado">
                <Input value="No editable" disabled />
              </FormField>
            </div>
            <Button type="submit">Guardar muestra</Button>
          </form>
        </InstrumentPanel>
        <InstrumentPanel label={{ children: "Búsqueda y selección" }}>
          <div className="space-y-7">
            <div className="crate-form-field">
              <MonoLabel>Búsqueda con espera</MonoLabel>
              <SearchInput
                label="Buscar en la muestra"
                placeholder="Artista, álbum o canción"
                clearLabel="Limpiar búsqueda de muestra"
                onDebouncedChange={setQuery}
              />
              <p className="font-mono text-eyebrow text-text-subtle">
                Búsqueda aplicada: {query || "ninguna"}
              </p>
            </div>
            <div className="space-y-5">
              <label className="flex min-h-11 items-center justify-between gap-5 text-sm text-text-primary">
                Reproducción automática
                <Switch checked={autoplay} onCheckedChange={setAutoplay} />
              </label>
              <label className="flex min-h-11 items-center gap-4 text-sm text-text-primary">
                <Checkbox
                  checked={keepQueue}
                  onCheckedChange={(checked) => setKeepQueue(checked === true)}
                />
                Conservar la cola de muestra
              </label>
              <label className="flex min-h-11 items-center gap-4 text-sm text-text-primary">
                <Checkbox checked="indeterminate" />
                Selección parcial
              </label>
            </div>
            <div className="crate-form-field">
              <MonoLabel>Grupo de chips</MonoLabel>
              <SegmentedControl
                as="radio"
                label="Orden de muestra"
                value={order}
                onValueChange={setOrder}
                items={[
                  { value: "recent", label: "Recientes" },
                  { value: "name", label: "Nombre" },
                  { value: "year", label: "Año" },
                ]}
              />
            </div>
            <div role="group" aria-label="Formato estándar">
              <FormField
                label="Formato estándar"
                hint="Ocho opciones: el desplegable sigue siendo apropiado."
              >
                {(control) => (
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formatOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <div
              role="group"
              aria-label="Formato con búsqueda"
              className="crate-form-field"
            >
              <MonoLabel>Formato con búsqueda</MonoLabel>
              <AdminSelect
                value={adminFormat}
                onChange={setAdminFormat}
                options={formatOptions}
                placeholder="Formato de archivo"
                searchable
                searchPlaceholder="Filtrar formatos de muestra"
                noMatchesLabel="No hay coincidencias en la muestra"
              />
            </div>
          </div>
        </InstrumentPanel>
      </div>
      <p role="status" className="admin-baseline-note mt-5">
        {status}
      </p>
      <p className="admin-baseline-note">
        Las opciones cortas ya usan chips en el checkpoint 1P de selección.
      </p>
    </section>
  );
}
