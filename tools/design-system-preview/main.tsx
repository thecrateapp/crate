import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import "./style.css";

const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

const adminCaptureImages = import.meta.glob<string>(
  "./.artifacts/admin-captures/*.png",
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
  const [focusActions, setFocusActions] = useState(0);
  const [search, setSearch] = useState("");
  const [focusGenre, setFocusGenre] = useState("jazz");
  const [editableGenres, setEditableGenres] = useState(artistGenreProfile);
  const [openedGenre, setOpenedGenre] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
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
  return (
    <main>
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Crate, inicio">
          crate<span className="version">v3</span>
        </a>
        <MonoLabel
          meta={["Checkpoint 1E", "Base de Admin · En revisión"]}
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
              Checkpoint 1E · En revisión
            </MonoLabel>
            <h2>La base de Admin, antes de cambiarla.</h2>
          </div>
        </div>
        <p className="admin-baseline-note">
          Vistas locales de referencia. Capturas definitivas de Linux
          pendientes.
        </p>
        <p className="admin-baseline-note">
          Estas siete pantallas muestran el Admin actual, antes de adaptar sus
          tarjetas y paneles a V3. Abre una imagen para verla completa.
        </p>
        <div className="admin-capture-grid">
          {adminScenes.map(({ key, label }) => {
            const source =
              adminCaptureImages[
                `./.artifacts/admin-captures/admin-${key}.png`
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
      <footer>
        <MonoLabel
          meta={["1A–1C publicados", "1D provisional", "1E en revisión"]}
        />
        <p>Mockup de revisión · componentes reales · datos ficticios</p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
