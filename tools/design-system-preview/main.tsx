import { AdminNavigationCheckpoint } from "./admin-navigation-checkpoint";
import { AdminOpsCheckpoint } from "./admin-ops-checkpoint";
import { AdminControlsCheckpoint } from "./admin-controls-checkpoint";
import { AdminIconCheckpoint } from "./admin-icon-checkpoint";
import { SkipLinkCheckpoint } from "./skip-link-checkpoint";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import {
  DEFAULT_UI_PREFERENCES,
  migrateUiPreferences,
  type UiPreferences,
} from "@crate/ui/lib/interface-preferences";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { CratePill, CrateChip } from "@crate/ui/primitives/CrateBadge";
import {
  GenrePill,
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "@crate/ui/primitives/FormField";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { Meter } from "@crate/ui/primitives/Meter";
import { Readout } from "@crate/ui/primitives/Readout";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@crate/ui/shadcn/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@crate/ui/shadcn/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@crate/ui/shadcn/popover";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@crate/ui/shadcn/tooltip";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { toast, Toaster } from "sonner";
import {
  Section,
  ToggleRow,
} from "../../app/listen/src/components/settings/SettingsPrimitives";
import adminTrackReadoutReference from "./references/admin-track-readout.png";
import { InterfacePreferencesControls } from "../../app/listen/src/components/settings/InterfacePreferencesSection";
import "./style.css";
import { FormsCheckpoint } from "./forms-checkpoint";
import { SelectionCheckpoint } from "./selection-checkpoint";
import { TabsCheckpoint } from "./tabs-checkpoint";
import { StatusColourCheckpoint } from "./status-colour-checkpoint";
import { TracksCheckpoint } from "./tracks-checkpoint";
import { StatesCheckpoint } from "./states-checkpoint";

applyCrateIdentity();
const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

const adminCaptureImages = import.meta.glob<string>(
  "../../tests/admin-e2e/captures.spec.ts-snapshots/*.png",
  { eager: true, query: "?url", import: "default" },
);
const adminScenes = [
  { key: "dashboard", label: "Dashboard" },
  { key: "tasks", label: "Tasks" },
  { key: "health", label: "Library Health" },
  { key: "genres", label: "Genres" },
  { key: "album", label: "Album" },
  { key: "settings", label: "Settings" },
  { key: "system", label: "System Health" },
];
const adminContrastImages = import.meta.glob<string>(
  "./.artifacts/admin-contrast/**/*.png",
  { eager: true, query: "?url", import: "default" },
);
const adminContrastScenes = [
  {
    name: "admin-audio-profile-kpis",
    title: "Audio Profile",
    description:
      "Componente anterior con un ajuste temporal de contraste. Será sustituido por TrackReadout.",
    width: 220,
  },
  {
    name: "admin-image-crop-modal",
    title: "Recorte de imagen",
    description:
      "Cambio mínimo: solo un borde exterior de 1 px. El rediseño del modal llegará con la tarea 1b.1.",
    width: 600,
  },
];

const artistGenreProfile: GenreProfileItem[] = [
  {
    name: "Shoegaze",
    slug: "shoegaze",
    percent: 61,
    source: "Perfil de ejemplo",
  },
  {
    name: "Dream pop",
    slug: "dream-pop",
    share: 0.27,
    source: "Perfil de ejemplo",
  },
  {
    name: "Ambient",
    slug: "ambient",
    percent: 12,
    source: "Perfil de ejemplo",
  },
];

function App() {
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [sampleConfirmOpen, setSampleConfirmOpen] = useState(false);
  const [sampleDetails, setSampleDetails] = useState(false);
  const [sampleLibraryName, setSampleLibraryName] = useState("Sala de escucha");
  const [sampleLayerStatus, setSampleLayerStatus] = useState(
    "Ejemplos locales, sin cambios en tu biblioteca.",
  );
  const [samplePreferences, setSamplePreferences] = useState<UiPreferences>(
    DEFAULT_UI_PREFERENCES,
  );
  const [sampleMigrated, setSampleMigrated] = useState(false);

  function loadLegacySample() {
    const memory = new Map<string, string>([
      [
        "crate.listen.appearance.v2",
        JSON.stringify({
          version: 2,
          mode: "light",
          preset: "crateRed",
          overrides: { accent: "violet", material: "glass", effects: "off" },
          presentation: { density: "compact" },
          accessibility: { motion: "reduced" },
        }),
      ],
    ]);
    setSamplePreferences(
      migrateUiPreferences({
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
          memory.set(key, value);
        },
        removeItem: (key) => {
          memory.delete(key);
        },
      }),
    );
    setSampleMigrated(true);
  }
  const [readoutPreview, setReadoutPreview] = useState("Genre · Shoegaze");
  const [readoutCommitted, setReadoutCommitted] = useState("Genre · Shoegaze");
  const [meterOver, setMeterOver] = useState(false);
  const [panelLive, setPanelLive] = useState(true);
  const [normalization, setNormalization] = useState(false);
  const [focusActions, setFocusActions] = useState(0);
  const [search, setSearch] = useState("");
  const [focusGenre, setFocusGenre] = useState("jazz");
  const [editableGenres, setEditableGenres] = useState(artistGenreProfile);
  const [openedGenre, setOpenedGenre] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
  const [importProgress, setImportProgress] = useState(0.5);
  const [preparingAudio, setPreparingAudio] = useState(true);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastAction, setToastAction] = useState("");
  const [above, setAbove] = useState(false);
  const [selected, setSelected] = useState(0);
  const [genres, setGenres] = useState(["Jazz", "Ambient"]);
  const tracks = [
    "Everything in Its Right Place",
    "Daydreaming",
    "Weird Fishes / Arpeggi",
  ];
  function toggleGenre(genre: string) {
    setGenres((current) =>
      current.includes(genre)
        ? current.filter((item) => item !== genre)
        : [...current, genre],
    );
  }
  function toggleMotion() {
    const next = !motion;
    document.documentElement.dataset.crateMotion = next ? "full" : "reduced";
    setMotion(next);
  }
  function showToastExample(kind: "success" | "info" | "error") {
    toast.dismiss("checkpoint-toast-secondary");
    setToastVisible(true);
    setToastAction("");
    const options = {
      id: "checkpoint-toast",
      toasterId: "checkpoint-toasts",
      duration: Infinity,
      action: undefined,
    };
    if (kind === "success") {
      toast.success("Guardado en tu colección", {
        ...options,
        description: "12 canciones añadidas.",
      });
    } else if (kind === "info") {
      toast.info("Análisis en cola", {
        ...options,
        description: "12 álbumes pendientes de procesar.",
      });
    } else {
      toast.error("No se ha podido completar la tarea", {
        ...options,
        description: "El servidor no está disponible.",
        action: {
          label: "Reintentar",
          onClick: (event) => {
            event.preventDefault();
            setToastAction("Reintento solicitado");
          },
        },
      });
    }
  }
  function showToastStack() {
    setToastVisible(true);
    setToastAction("");
    const options = {
      toasterId: "checkpoint-toasts",
      duration: Infinity,
      action: undefined,
    };
    toast.error("No se ha podido completar el análisis de tu colección", {
      ...options,
      id: "checkpoint-toast",
      description:
        "El servidor no está disponible. Puedes reintentar la operación más tarde.",
    });
    toast.info("Análisis en cola", {
      ...options,
      id: "checkpoint-toast-secondary",
      description: undefined,
    });
  }
  return (
    <main>
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Crate, inicio">
          crate<span className="version">v3</span>
        </a>
        <MonoLabel
          meta={["Checkpoint 1P", "Selección"]}
          className="masthead-meta"
        />
        <a className="jump" href="#primitivas">
          Ver primitivas <span aria-hidden="true">↘</span>
        </a>
      </header>
      <section id="top" className="intro">
        <MonoLabel
          size="eyebrow"
          accent="01"
          meta={["Tu colección", "Sin límites"]}
        />
        <h1>
          El ritmo de
          <br />
          tu biblioteca.
        </h1>
        <p>Toda tu música. Cada detalle en su sitio.</p>
      </section>
      <section
        className="library"
        aria-label="Ejemplo de biblioteca con datos ficticios"
      >
        <div className="collection">
          <div className="section-top">
            <MonoLabel as="h2" accent="/" meta={["La colección"]} />
            <StatusDot tone="on" label="Al día" />
          </div>
          <div className="big-stat">
            <StatNumber
              size="xl"
              value="48.216"
              label="Canciones en tu biblioteca"
            />
          </div>
          <div className="secondary-stats">
            <StatNumber value="4.400" label="Álbumes" size="md" />
            <StatNumber value="900" label="Artistas" size="md" />
            <StatNumber
              value="1,2"
              unit="TB"
              label="Música guardada"
              size="md"
            />
          </div>
        </div>
        <aside className="services">
          <MonoLabel as="h2" accent="/">
            Ahora mismo
          </MonoLabel>
          <div className="service">
            <div>
              <h3>Biblioteca</h3>
              <p>Todo listo para escuchar</p>
            </div>
            <StatusDot tone="on" label="Activa" />
          </div>
          <div className="service">
            <div>
              <h3>Análisis de audio</h3>
              <p>Preparando tu colección</p>
            </div>
            <StatusDot tone="on" pulse label="En curso" />
          </div>
          <div className="service">
            <div>
              <h3>Enriquecimiento</h3>
              <p>Requiere tu atención</p>
            </div>
            <StatusDot tone="warn" label="Pendiente" />
          </div>
          <div className="service">
            <div>
              <h3>Adquisición</h3>
              <p>Sin tareas pendientes</p>
            </div>
            <StatusDot tone="off" label="En pausa" />
          </div>
          <MonoLabel className="sample-note">Datos de ejemplo</MonoLabel>
        </aside>
      </section>
      <section id="primitivas" className="specimens">
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="02">
              Las piezas, de cerca
            </MonoLabel>
            <h2>
              Pequeños detalles.
              <br className="mobile-break" /> Una misma voz.
            </h2>
          </div>
          <span className="count">3 primitivas</span>
        </div>
        <div className="specimen-grid">
          <article className="specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="01">
                MonoLabel
              </MonoLabel>
              <span>Jerarquía</span>
            </div>
            <div className="label-examples">
              <div>
                <span className="hint">ETIQUETA</span>
                <MonoLabel>Tu biblioteca</MonoLabel>
              </div>
              <div>
                <span className="hint">EYEBROW</span>
                <MonoLabel size="eyebrow" accent="/">
                  Descubre más
                </MonoLabel>
              </div>
              <div>
                <span className="hint">METADATOS</span>
                <MonoLabel meta={["Radiohead", "1997", "12 canciones"]} />
              </div>
            </div>
            <p className="explanation">
              La misma cadencia para secciones, índices y metadatos.
            </p>
          </article>
          <article className="specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="02">
                StatusDot
              </MonoLabel>
              <span>Estado</span>
            </div>
            <div className="dot-examples">
              <StatusDot tone="on" label="Disponible" />
              <StatusDot tone="warn" label="Necesita atención" />
              <StatusDot tone="off" label="Desactivado" />
              <StatusDot tone="on" pulse label="Procesando" />
            </div>
            <button
              className="control"
              type="button"
              aria-pressed={!motion}
              onClick={toggleMotion}
            >
              {motion ? "Pausar movimiento" : "Activar movimiento"}
              <span aria-hidden="true">{motion ? "Ⅱ" : "▷"}</span>
            </button>
          </article>
          <article className="specimen numeral-specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="03">
                StatNumber
              </MonoLabel>
              <span>Lectura</span>
            </div>
            <div className="inline-stat">
              <StatNumber
                size="lg"
                value="96"
                unit="kHz"
                label="Frecuencia de muestreo"
                labelPosition={above ? "above" : "below"}
              />
            </div>
            <button
              className="control"
              type="button"
              aria-pressed={above}
              onClick={() => setAbove(!above)}
            >
              Etiqueta {above ? "debajo" : "encima"}
              <span aria-hidden="true">↕</span>
            </button>
          </article>
        </div>
        <div className="scale">
          <div className="scale-intro">
            <MonoLabel accent="/">Escala numérica</MonoLabel>
            <p>
              Del detalle
              <br />
              al protagonista.
            </p>
          </div>
          <div className="scale-item">
            <StatNumber size="sm" value="128" unit="kbps" label="sm" />
          </div>
          <div className="scale-item">
            <StatNumber size="md" value="24" unit="bit" label="md" />
          </div>
          <div className="scale-item">
            <StatNumber size="lg" value="96" unit="kHz" label="lg" />
          </div>
          <div className="scale-item">
            <StatNumber size="xl" value="48" unit="kHz" label="xl" />
          </div>
        </div>
      </section>
      <section
        id="filas-y-chips"
        className="next-batch"
        aria-label="Checkpoint 1B, filas y chips"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="03">
              Checkpoint 1B · Aprobado
            </MonoLabel>
            <h2>
              Filas que guían.
              <br className="mobile-break" /> Controles que responden.
            </h2>
          </div>
          <a className="jump" href="#primitivas">
            Volver a 1A <span aria-hidden="true">↑</span>
          </a>
        </div>
        <div className="next-grid">
          <article className="next-specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="04">
                HairlineList / Row
              </MonoLabel>
              <span>Activa · enlace · multilínea</span>
            </div>
            <HairlineList
              label="Vista previa de canciones"
              className="rows-preview"
            >
              {tracks.slice(0, 2).map((track, index) => (
                <HairlineRow
                  key={track}
                  asChild
                  index={index + 1}
                  active={selected === index}
                  trailing={
                    <MonoLabel as="span">
                      {index === 0 ? "4:11" : "6:24"}
                    </MonoLabel>
                  }
                >
                  <button
                    type="button"
                    aria-pressed={selected === index}
                    onClick={() => setSelected(index)}
                  >
                    {track}
                  </button>
                </HairlineRow>
              ))}
              <HairlineRow
                asChild
                index={3}
                active={selected === 2}
                trailing={<MonoLabel as="span">5:18</MonoLabel>}
              >
                <a href="#detalle-cancion" onClick={() => setSelected(2)}>
                  {tracks[2]}
                </a>
              </HairlineRow>
              <HairlineRow index={4} truncate={false} muted>
                <div>
                  Una fila que respira.
                  <p className="row-description">
                    Contenido en varias líneas, sin recortar la información que
                    necesitas leer.
                  </p>
                </div>
              </HairlineRow>
            </HairlineList>
            <div
              id="detalle-cancion"
              className="track-detail"
              aria-live="polite"
            >
              <MonoLabel accent="/">Fila seleccionada</MonoLabel>
              <p>{tracks[selected]}</p>
            </div>
          </article>
          <article className="next-specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="05">
                Pills / Chips
              </MonoLabel>
              <span>Filtro · acción · etiqueta</span>
            </div>
            <MonoLabel className="example-label">
              Filtros seleccionables
            </MonoLabel>
            <div
              role="group"
              aria-label="Géneros musicales"
              className="pill-group"
            >
              {["Jazz", "Ambient", "Rock", "Electrónica"].map((genre) => (
                <CratePill
                  key={genre}
                  variant="toggle"
                  active={genres.includes(genre)}
                  onClick={() => toggleGenre(genre)}
                >
                  {genre}
                </CratePill>
              ))}
            </div>
            <p className="filter-feedback" aria-live="polite">
              {genres.length
                ? `${genres.length} géneros seleccionados`
                : "Todos los géneros"}
            </p>
            <div className="pill-group">
              <CratePill variant="action" onClick={() => setGenres([])}>
                Limpiar filtros
              </CratePill>
              <CratePill variant="action" disabled>
                Próximamente
              </CratePill>
            </div>
            <MonoLabel className="example-label">
              Etiquetas sin interacción
            </MonoLabel>
            <div className="pill-group">
              <CrateChip tone="accent">FLAC</CrateChip>
              <CrateChip active>24 bit</CrateChip>
              <CrateChip>Estéreo</CrateChip>
              <CrateChip tone="warning">Sin portada</CrateChip>
            </div>
            <p className="explanation">
              Los filtros anuncian su selección. Las acciones ejecutan. Las
              etiquetas informan.
            </p>
          </article>
        </div>
      </section>
      <section
        id="genre-pill"
        className="genre-feature"
        aria-label="Checkpoint 1C, GenrePill con porcentajes"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="04">
              Checkpoint 1C · Aprobado
            </MonoLabel>
            <h2>
              El género es identidad.
              <br />
              El porcentaje, contexto.
            </h2>
          </div>
          <span className="count">Se mantiene en V3</span>
        </div>
        <div className="genre-layout">
          <article className="genre-context">
            <MonoLabel
              accent="/"
              meta={["Perfil de artista", "Datos ficticios"]}
            />
            <h3 className="genre-artist">Slowdive</h3>
            <p className="genre-lede">
              Una etiqueta nombra el sonido.
              <br />
              El perfil cuenta sus matices.
            </p>
            <div role="group" aria-label="Perfil de género del artista">
              <GenrePillRow
                items={artistGenreProfile}
                onSelect={(item) => setOpenedGenre(item.name)}
              />
            </div>
            <div className="genre-selection" aria-live="polite">
              <MonoLabel>
                {openedGenre
                  ? `Abrir género · ${openedGenre}`
                  : "Pulsa un género para explorar"}
              </MonoLabel>
            </div>
            <p className="genre-caption">
              Nombre y porcentaje permanecen juntos. La apariencia cambia; el
              dato conserva su significado.
            </p>
          </article>
          <article className="genre-specimen">
            <MonoLabel as="h3" accent="06">
              El mismo componente, cada contexto
            </MonoLabel>
            <MonoLabel className="example-label">
              Con y sin porcentaje
            </MonoLabel>
            <div
              className="pill-group"
              role="group"
              aria-label="Porcentajes opcionales"
            >
              <GenrePill item={{ name: "Post-rock" }} />
              <GenrePill item={{ name: "Drone", percent: 0 }} />
              <GenrePill item={{ name: "Noise", percent: 100 }} />
            </div>
            <p className="filter-feedback">
              Sin dato, solo el nombre. Un 0 % sigue siendo un dato.
            </p>
            <MonoLabel className="example-label">
              Edición sin perder contexto
            </MonoLabel>
            <div
              className="pill-group"
              role="group"
              aria-label="Etiquetas editables"
            >
              {editableGenres.map((item) => (
                <GenrePill
                  key={item.slug}
                  item={item}
                  onClick={() => setOpenedGenre(item.name)}
                  onRemove={() =>
                    setEditableGenres((current) =>
                      current.filter((genre) => genre.slug !== item.slug),
                    )
                  }
                  removeLabel={`Quitar ${item.name.toLowerCase()}`}
                />
              ))}
            </div>
            <div className="genre-reset">
              <CratePill
                variant="action"
                onClick={() => setEditableGenres(artistGenreProfile)}
              >
                Restaurar etiquetas
              </CratePill>
            </div>
            <MonoLabel className="example-label">
              Nombre largo, porcentaje visible
            </MonoLabel>
            <div className="genre-long">
              <GenrePill
                item={{
                  name: "Atmospheric blackened progressive post-rock",
                  percent: 38,
                }}
              />
            </div>
          </article>
        </div>
      </section>
      <section
        id="foco"
        tabIndex={-1}
        className="focus-feature"
        aria-label="Checkpoint 1D, foco de teclado y selección"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="05">
              Checkpoint 1D · Provisional
            </MonoLabel>
            <h2>
              El teclado también
              <br />
              tiene un camino.
            </h2>
          </div>
          <span className="count">
            Tab para recorrer · Mayús + Tab para volver
          </span>
        </div>
        <div className="focus-layout">
          <article className="focus-specimen">
            <MonoLabel as="h3" accent="07">
              Una señal consistente
            </MonoLabel>
            <p className="focus-copy">
              El anillo se enciende y se apaga suavemente, como en el buscador
              de Listen. Pulsa Tab para recorrer los ejemplos.
            </p>
            <div className="focus-controls">
              <div>
                <MonoLabel className="focus-caption">
                  Control · anillo a ras
                </MonoLabel>
                <CratePill
                  variant="action"
                  onClick={() => setFocusActions((value) => value + 1)}
                >
                  Añadir a la cola
                </CratePill>
              </div>
              <div>
                <MonoLabel className="focus-caption">
                  Acción principal · mismo anillo
                </MonoLabel>
                <Button onClick={() => setFocusActions((value) => value + 1)}>
                  Reproducir ahora
                </Button>
              </div>
            </div>
            <label htmlFor="preview-search" className="focus-field-label">
              Buscar en la biblioteca
            </label>
            <Input
              id="preview-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Artista, álbum o canción"
            />
            <div className="focus-select">
              <label id="preview-genre-label" className="focus-field-label">
                Género de ejemplo
              </label>
              <Select value={focusGenre} onValueChange={setFocusGenre}>
                <SelectTrigger aria-labelledby="preview-genre-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jazz">Jazz</SelectItem>
                  <SelectItem value="ambient">Ambient</SelectItem>
                  <SelectItem value="rock">Rock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="filter-feedback" aria-live="polite">
              {search
                ? `Buscando «${search}» en este ejemplo`
                : `${focusActions} acciones de ejemplo`}
            </p>
          </article>
          <article className="focus-specimen">
            <MonoLabel as="h3" accent="08">
              Filas y texto
            </MonoLabel>
            <p className="focus-copy">
              En las filas, el contorno va hacia dentro para que los bordes no
              lo recorten.
            </p>
            <HairlineList
              label="Demostración de foco en filas"
              className="focus-rows"
            >
              <HairlineRow
                asChild
                index={1}
                trailing={<MonoLabel as="span">4:11</MonoLabel>}
              >
                <button
                  type="button"
                  onClick={() => setFocusActions((value) => value + 1)}
                >
                  Abrir canción
                </button>
              </HairlineRow>
            </HairlineList>
            <MonoLabel className="focus-caption">Selección de texto</MonoLabel>
            <p className="selection-example">
              Selecciona esta frase para comprobar el acento de Crate.
            </p>
          </article>
        </div>
      </section>
      <section
        id="base-admin"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1E, referencias visuales de Admin"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="06">
              Checkpoint 1E · Publicado
            </MonoLabel>
            <h2>La base de Admin, antes de cambiarla.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Referencias de Linux CI. Capturas base verificadas.
        </p>
        <p className="admin-baseline-note">
          Estas siete pantallas muestran el Admin actual, antes de adaptar sus
          tarjetas y paneles a V3. Abre una imagen para verla completa.
        </p>
        <div className="admin-capture-grid">
          {adminScenes.map(({ key, label }) => {
            const source =
              adminCaptureImages[
                `../../tests/admin-e2e/captures.spec.ts-snapshots/admin-${key}.png`
              ];
            return (
              <figure key={key}>
                {source ? (
                  <a href={source} target="_blank" rel="noreferrer">
                    <img
                      src={source}
                      alt={`Admin actual: ${label}`}
                      loading="lazy"
                      width={1440}
                    />
                  </a>
                ) : (
                  <p className="admin-capture-pending">
                    Vista local pendiente de generar
                  </p>
                )}
                <figcaption>{label}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>
      <section
        id="contraste-admin"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1F, contraste de tarjetas de Admin"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="07">
              Checkpoint 1F · Publicado
            </MonoLabel>
            <h2>Tarjetas que se distinguen.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Comparación local. Capturas de Linux del cambio verificadas.
        </p>
        <p className="admin-baseline-note">
          Ajuste provisional de contraste. El diseño final de Audio Profile es
          TrackReadout.
        </p>
        <aside
          id="audio-profile-objetivo"
          className="admin-audio-target"
          aria-labelledby="audio-profile-objetivo-heading"
        >
          <MonoLabel as="h3" id="audio-profile-objetivo-heading">
            Audio Profile · diseño objetivo
          </MonoLabel>
          <p className="admin-baseline-note">
            Referencia visual del site aportada por Diego. Cifras grandes,
            reglas, cinco barras y vector Bliss, sin cajas de métricas ni
            iconos. Pendiente de implementar en la tarea 3.9b.
          </p>
          <a href={adminTrackReadoutReference} target="_blank" rel="noreferrer">
            <img
              src={adminTrackReadoutReference}
              alt="Referencia visual de TrackReadout del site: cifras, cinco barras y vector Bliss, sin iconos"
              width={1412}
              height={1048}
              loading="lazy"
            />
          </a>
          <p className="admin-baseline-note">
            Imagen de referencia, no captura de la app. La app conservará dB
            hasta disponer de una medición LUFS validada. Admin V3 prescinde de
            casi todos los iconos, también en navegación y acciones con texto.
          </p>
        </aside>
        <div className="admin-contrast-layout">
          {adminContrastScenes.map(({ name, title, description, width }) => (
            <article key={name} className="admin-contrast-specimen">
              <MonoLabel as="h3">{title}</MonoLabel>
              <p className="admin-baseline-note">{description}</p>
              <div className="admin-contrast-pair">
                {(["before", "after"] as const).map((phase) => {
                  const source =
                    adminContrastImages[
                      `./.artifacts/admin-contrast/${phase}/${name}.png`
                    ];
                  return (
                    <figure key={phase}>
                      <figcaption>
                        {phase === "before" ? "Antes" : "Con borde"}
                      </figcaption>
                      {source ? (
                        <a href={source} target="_blank" rel="noreferrer">
                          <img
                            src={source}
                            alt={`${title}: ${
                              phase === "before" ? "antes" : "con borde"
                            }`}
                            width={width}
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <p className="admin-capture-pending">
                          Vista local pendiente de generar
                        </p>
                      )}
                    </figure>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section
        id="paneles"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1G, InstrumentPanel"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="08">
              Checkpoint 1G · Aprobado
            </MonoLabel>
            <h2>Una estructura común para los paneles.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          InstrumentPanel real y la sección de Settings que ya lo utiliza. Una
          regla, etiquetas y estado; el contenido conserva su propia estructura.
          Datos ficticios para revisar el componente. Capturas Linux de 1G
          revisadas.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            label={{ children: "Resources" }}
            headingLevel={3}
            meta="Actualizado hace 12 s"
            status={
              <StatusDot
                tone={panelLive ? "on" : "off"}
                label={panelLive ? "En vivo" : "En pausa"}
              />
            }
            summary="280 GB de música y 12 pistas pendientes."
          >
            <div className="instrument-preview-values">
              <StatNumber value="280" unit="GB" label="Música" size="md" />
              <StatNumber value="12" label="Pendientes" size="md" />
            </div>
            <p className="admin-baseline-note mt-5">
              El estado se anuncia por separado de las mediciones.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={() => setPanelLive((live) => !live)}
            >
              {panelLive ? "Pausar panel" : "Reanudar panel"}
            </Button>
          </InstrumentPanel>
          <Section
            title="Reproducción de ejemplo"
            description="Preferencias del reproductor."
          >
            <ToggleRow
              label="Normalizar volumen"
              description="Control real de Settings con estado local de ejemplo."
              checked={normalization}
              onChange={setNormalization}
            />
          </Section>
          <InstrumentPanel
            as="section"
            label={{ children: "Panel sin regla" }}
            headingLevel={3}
            ruled={false}
          >
            <p className="admin-baseline-note">
              Variante sin separador superior para una sección que ya tiene su
              propia división.
            </p>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="meters"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1H, Meter"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="09">
              Checkpoint 1H · Aprobado
            </MonoLabel>
            <h2>Medir capacidad sin ocultar los límites.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Pistas disponibles, capacidad y límite. El aviso incluye texto; una
          lectura ausente se distingue de cero. Datos ficticios para revisar
          Meter. Capturas Linux de 1H revisadas.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Uso y capacidad" }}
          >
            <div className="meter-preview-rows">
              <Meter
                label="Pistas offline"
                value={36}
                max={48}
                valueText="36/48"
                thickness={2}
              />
              <Meter
                label="Transcodificación"
                value={meterOver ? 5 : 2}
                max={4}
                limit={3}
                over={meterOver}
                valueText={meterOver ? "5/4" : "2/4"}
                thickness={2}
              />
              <Meter label="Sin datos" value={null} max={4} valueText="n/a" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={() => setMeterOver((over) => !over)}
            >
              {meterOver ? "Restablecer capacidad" : "Superar límite"}
            </Button>
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Grosores de la escala" }}
          >
            <div className="meter-preview-rows">
              {([1, 2, 3, 4] as const).map((thickness) => (
                <Meter
                  key={thickness}
                  label={`Grosor ${thickness}`}
                  value={48}
                  max={100}
                  valueText="48%"
                  thickness={thickness}
                />
              ))}
            </div>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="readout"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1I, Readout"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="10">
              Checkpoint 1I · Aprobado
            </MonoLabel>
            <h2>Una lectura estable, un anuncio al confirmar.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          La vista previa conserva espacio para la lectura y mantiene el último
          anuncio confirmado. Datos ficticios para revisar el componente.
          Capturas Linux de 1I revisadas.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Origen del EQ" }}
          >
            <div data-readout-example="interactive">
              <Readout minWidthCh={32} announcement={readoutCommitted}>
                {readoutPreview}
              </Readout>
            </div>
            <div className="readout-preview-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReadoutPreview("Genre · Ambient")}
              >
                Previsualizar Ambient
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReadoutCommitted(readoutPreview)}
              >
                Confirmar lectura
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReadoutPreview("Genre · Shoegaze");
                  setReadoutCommitted("Genre · Shoegaze");
                }}
              >
                Restablecer lectura
              </Button>
            </div>
            <div className="mt-5">
              <MonoLabel>Último anuncio confirmado</MonoLabel>
              <p className="admin-baseline-note mt-2">{readoutCommitted}</p>
            </div>
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Lectura informativa" }}
          >
            <Readout>Solo lectura visual</Readout>
            <p className="admin-baseline-note mt-5">
              Variante sin anuncio automático. Usa la misma tipografía y reserva
              de espacio.
            </p>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="progreso"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1J, ProgressHairline"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="11">
              Checkpoint 1J · Aprobado
            </MonoLabel>
            <h2>El progreso, en una línea.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Avance confirmado y preparación sin porcentaje conocido. La animación
          se detiene fuera de pantalla y respeta movimiento reducido. Datos
          ficticios para revisar la primitiva. Capturas Linux de 1J revisadas.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Importación de biblioteca" }}
          >
            <div className="progress-preview-reading">
              <Readout>{Math.round(importProgress * 24)} / 24 álbumes</Readout>
              <span className="text-right">
                <Readout>{Math.round(importProgress * 100)} %</Readout>
              </span>
            </div>
            <ProgressHairline
              label="Importación de biblioteca"
              value={importProgress}
              valueText={`${Math.round(importProgress * 24)} / 24 álbumes`}
            />
            <div className="readout-preview-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setImportProgress((value) => Math.min(1, value + 0.25))
                }
              >
                Avanzar 25 %
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setImportProgress(0)}
              >
                Reiniciar progreso
              </Button>
            </div>
            <p className="admin-baseline-note mt-5">
              Trazo de 2 px. El cero y el final conservan su valor real.
            </p>
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Preparación de audio" }}
          >
            <div className="progress-preview-reading">
              <StatusDot
                tone={preparingAudio ? "on" : "off"}
                label={preparingAudio ? "Preparando" : "Completado"}
              />
            </div>
            <ProgressHairline
              label="Preparación de audio"
              thickness={1}
              value={preparingAudio ? undefined : 1}
              valueText={
                preparingAudio ? "Esperando confirmación" : "Completado"
              }
            />
            <div className="readout-preview-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreparingAudio((value) => !value)}
              >
                {preparingAudio ? "Completar preparación" : "Volver a preparar"}
              </Button>
            </div>
            <p className="admin-baseline-note mt-5">
              Trazo de 1 px. Bloque del 36 %; queda estático cuando se reduce el
              movimiento. El porcentaje aparece cuando conocemos el resultado.
            </p>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="toasts"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1K, Toasts"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="12">
              Checkpoint 1K · Aprobado
            </MonoLabel>
            <h2>Un mismo lenguaje para cada aviso.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Avisos reales con la configuración compartida de Admin y Listen. Datos
          ficticios y acciones locales. En las apps duran 4 segundos por
          defecto; aquí permanecen visibles para revisarlos. Capturas Linux de
          1K revisadas.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Prueba un aviso" }}
          >
            <div className="readout-preview-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => showToastExample("success")}
              >
                Mostrar guardado
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => showToastExample("info")}
              >
                Mostrar cola
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => showToastExample("error")}
              >
                Mostrar error
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  toast.dismiss("checkpoint-toast");
                  toast.dismiss("checkpoint-toast-secondary");
                  setToastVisible(false);
                  setToastAction("");
                }}
              >
                Limpiar avisos
              </Button>
              <Button type="button" variant="outline" onClick={showToastStack}>
                Probar pila
              </Button>
            </div>
            <p className="admin-baseline-note mt-5">
              La información que pertenece a un control se mantiene en ese
              control. El toast acompaña resultados que siguen siendo relevantes
              después de abandonarlo.
            </p>
            {toastAction ? (
              <p className="admin-baseline-note mt-5">{toastAction}</p>
            ) : null}
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Vista previa" }}
          >
            <div className="toast-preview-stage">
              {!toastVisible ? (
                <p className="admin-baseline-note">
                  Elige un aviso para probar su presentación.
                </p>
              ) : null}
              <Toaster
                {...toasterConfig}
                id="checkpoint-toasts"
                className="crate-toaster toast-preview-toaster"
                position="bottom-center"
                theme="dark"
                containerAriaLabel="Avisos de ejemplo"
              />
            </div>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="limpieza"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1L, Limpieza de componentes"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="13">
              Checkpoint 1L · Aprobado
            </MonoLabel>
            <h2>Una base compartida más limpia.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          La limpieza no cambia las pantallas actuales.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Código sin uso" }}
          >
            <div className="instrument-preview-values">
              <StatNumber value="4" label="Componentes retirados" size="md" />
              <StatNumber value="0" label="Consumidores activos" size="md" />
            </div>
            <p className="admin-baseline-note mt-5">
              Se retiran las copias compartidas que ninguna pantalla utiliza.
              Admin conserva sus paneles de operaciones. Admin y Listen
              conservan sus tarjetas de conciertos.
            </p>
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Retirados del paquete compartido" }}
          >
            <HairlineList as="ul" label="Componentes retirados" ruled={false}>
              {["OpsPageHero", "OpsPanel", "OpsStatTile", "ShowCard"].map(
                (name) => (
                  <HairlineRow
                    key={name}
                    trailing={<MonoLabel>Retirado</MonoLabel>}
                  >
                    {name}
                  </HairlineRow>
                ),
              )}
            </HairlineList>
            <p className="admin-baseline-note mt-5">
              Las primitivas aprobadas y todos los ejemplos anteriores
              permanecen disponibles en este mockup.
            </p>
          </InstrumentPanel>
        </div>
      </section>
      <section
        id="identidad"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1M, Identidad de Crate"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="14">
              Checkpoint 1M · Aprobado
            </MonoLabel>
            <h2>Una sola identidad. Tus preferencias se conservan.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Listen y Admin comparten los mismos colores, tipografías, superficies,
          primitivas e interacciones. Cada app conserva los componentes de su
          dominio.
        </p>
        <div className="instrument-preview-grid">
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Una base para las dos apps" }}
          >
            <div className="instrument-preview-values">
              <StatNumber value="1" label="Identidad de Crate" size="md" />
              <StatNumber value="2" label="Apps, mismas primitivas" size="md" />
            </div>
            <GenrePillRow items={artistGenreProfile} className="mt-6" />
            <p className="admin-baseline-note mt-5">
              Las preferencias antiguas se convierten en ajustes de movimiento,
              efectos y densidad. La identidad visual permanece igual.
            </p>
            <div className="readout-preview-actions">
              <Button variant="outline" onClick={loadLegacySample}>
                Cargar preferencias antiguas
              </Button>
            </div>
            <p role="status" className="admin-baseline-note mt-5">
              {sampleMigrated
                ? "Muestra migrada: movimiento reducido, efectos desactivados y densidad compacta."
                : "Prueba una migración con datos ficticios."}
            </p>
          </InstrumentPanel>
          <div role="region" aria-label="Preferencias de la muestra">
            <InterfacePreferencesControls
              preferences={samplePreferences}
              onChange={(patch) =>
                setSamplePreferences((current) => ({ ...current, ...patch }))
              }
              labels={{
                title: "Tus preferencias",
                description: "Estos controles solo cambian la muestra.",
                motionLabel: "Movimiento",
                effectsLabel: "Efectos",
                densityLabel: "Densidad del contenido",
                values: {
                  system: "Seguir al sistema",
                  reduced: "Reducir movimiento",
                  off: "Desactivados",
                  subtle: "Sutiles",
                  expressive: "Expresivos",
                  comfortable: "Cómoda",
                  compact: "Compacta",
                },
              }}
            />
          </div>
        </div>
      </section>
      <section
        id="capas"
        className="admin-baseline-feature"
        aria-label="Checkpoint 1N, Diálogos y menús"
      >
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="15">
              Checkpoint 1N · En revisión
            </MonoLabel>
            <h2>Las mismas capas en las dos apps.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Diálogos, menús y ayudas con las mismas superficies, tipografía y
          reglas de teclado.
        </p>
        <TooltipProvider>
          <div className="instrument-preview-grid">
            <InstrumentPanel
              as="section"
              headingLevel={3}
              label={{ children: "Diálogos y confirmaciones" }}
            >
              <p className="admin-baseline-note">
                El foco permanece en la capa abierta y vuelve al control que la
                abrió. Las acciones destructivas piden confirmación.
              </p>
              <div className="readout-preview-actions">
                <Button
                  variant="outline"
                  onClick={() => setSampleModalOpen(true)}
                >
                  Abrir diálogo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSampleConfirmOpen(true)}
                >
                  Abrir confirmación
                </Button>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Abrir panel lateral</Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Preferencias de la muestra</SheetTitle>
                      <SheetDescription>
                        Un panel con la misma identidad de Crate.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="px-6">
                      <GenrePillRow items={artistGenreProfile} />
                    </div>
                    <SheetClose asChild>
                      <Button variant="ghost" className="mx-6">
                        Cerrar panel
                      </Button>
                    </SheetClose>
                  </SheetContent>
                </Sheet>
              </div>
            </InstrumentPanel>
            <InstrumentPanel
              as="section"
              headingLevel={3}
              label={{ children: "Menús y ayudas" }}
            >
              <p className="admin-baseline-note">
                Opciones claras, grupos en mono, estados visibles y superficies
                sin desenfoque.
              </p>
              <div className="readout-preview-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">Abrir menú</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Biblioteca de muestra</DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() =>
                        setSampleLayerStatus("Vista de muestra actualizada.")
                      }
                    >
                      Actualizar vista
                    </DropdownMenuItem>
                    <DropdownMenuCheckboxItem
                      checked={sampleDetails}
                      onCheckedChange={(checked) =>
                        setSampleDetails(checked === true)
                      }
                    >
                      Ver detalles
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Abrir popover</Button>
                  </PopoverTrigger>
                  <PopoverContent aria-label="Opciones de la muestra">
                    <MonoLabel>Opciones de la muestra</MonoLabel>
                    <p className="mt-3 text-sm text-text-muted">
                      Los mismos tokens y primitivas en Listen y Admin.
                    </p>
                  </PopoverContent>
                </Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost">Ver ayuda</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Las capas comparten identidad y teclado.
                  </TooltipContent>
                </Tooltip>
              </div>
            </InstrumentPanel>
          </div>
        </TooltipProvider>
        <p role="status" className="admin-baseline-note mt-5">
          {sampleLayerStatus}
        </p>
      </section>
      <FormsCheckpoint />
      <SelectionCheckpoint />
      <TabsCheckpoint />
      <StatesCheckpoint />
      <TracksCheckpoint />
      <StatusColourCheckpoint />
      <SkipLinkCheckpoint />
      <AdminIconCheckpoint />
      <AdminNavigationCheckpoint />
      <AdminControlsCheckpoint />
      <AdminOpsCheckpoint />
      <AppModal
        open={sampleModalOpen}
        onClose={() => setSampleModalOpen(false)}
        title="Editar biblioteca de muestra"
        eyebrow="Biblioteca"
        description="Estos cambios solo afectan al ejemplo."
        size="md"
        closeLabel="Cerrar"
      >
        <ModalBody className="px-6 py-5">
          <FormField label="Nombre de la biblioteca" className="gap-2">
            <Input
              value={sampleLibraryName}
              onChange={(event) => setSampleLibraryName(event.target.value)}
            />
          </FormField>
          <Button
            variant="ghost"
            className="mt-5"
            onClick={() => setSampleConfirmOpen(true)}
          >
            Confirmación anidada
          </Button>
        </ModalBody>
        <ModalFooter className="flex justify-end gap-3 px-6 py-4">
          <Button variant="ghost" onClick={() => setSampleModalOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setSampleLayerStatus("Biblioteca de muestra guardada.");
              setSampleModalOpen(false);
            }}
          >
            Guardar
          </Button>
        </ModalFooter>
      </AppModal>
      <ConfirmDialog
        open={sampleConfirmOpen}
        onOpenChange={setSampleConfirmOpen}
        title="Vaciar biblioteca de muestra"
        eyebrow="Confirmación"
        description="Es una demostración. Tu biblioteca real no se modifica."
        consequence="12 archivos · 1,4 GB · Biblioteca de muestra"
        confirmation={{
          value: "VACIAR",
          label: "Escribe VACIAR para confirmar",
        }}
        tone="danger"
        confirmLabel="Vaciar muestra"
        cancelLabel="Cancelar"
        closeLabel="Cerrar"
        onConfirm={async () => {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
          setSampleLayerStatus("Acción de muestra confirmada.");
        }}
      />
      <footer>
        <MonoLabel
          meta={[
            "1A–1C publicados",
            "1D provisional",
            "1E publicado",
            "1F publicado",
            "1G publicado",
            "1H publicado",
            "1I publicado",
            "1J publicado",
            "1K publicado",
            "1L publicado",
            "1M publicado",
            "1N publicado",
            "1O publicado",
            "1P publicado",
            "1Q publicado",
            "1R publicado",
            "1S publicado",
            "1T publicado · 1U publicado",
            "1V publicado",
            "1W publicado",
            "1X publicado",
            "1Y en revisión",
          ]}
        />
        <p>Mockup de revisión · componentes reales · datos ficticios</p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
