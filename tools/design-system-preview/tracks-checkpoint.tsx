import { TrackRowContent } from "../../app/listen/src/components/cards/TrackRowContent";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { useEffect, useRef, useState } from "react";
import { PlayerSeekBar } from "../../app/listen/src/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "../../app/listen/src/components/player/bar/player-bar-utils";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@crate/ui/shadcn/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@crate/ui/shadcn/dropdown-menu";
import {
  formatTrackAnalysis,
  formatTrackQuality,
} from "@crate/ui/lib/track-meta";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../app/listen/src/components/cards/TrackRowPlaybackControl";

const samplePlayerI18n = createInstance();
void samplePlayerI18n.init({
  initAsync: false,
  lng: "es",
  fallbackLng: "es",
  keySeparator: false,
  resources: { es: { translation: { "player.seek": "Posición de muestra" } } },
  interpolation: { escapeValue: false },
});

const tracks = [
  {
    id: 1,
    title: "La luz entre las hojas",
    artist: "Costa Norte",
    bpm: 124,
    key: "A",
    scale: "minor",
    duration: "4:03",
    format: "flac",
    depth: 24,
    rate: 96000,
  },
  {
    id: 2,
    title: "Todo lo que queda al volver a casa",
    artist: "Una habitación tranquila",
    bpm: 118,
    key: "F#",
    scale: "minor",
    duration: "5:18",
    format: "flac",
    depth: 16,
    rate: 44100,
  },
  {
    id: 3,
    title: "El rumor del agua",
    artist: "Costa Norte",
    bpm: null,
    key: null,
    scale: null,
    duration: "3:41",
    format: "mp3",
    depth: null,
    rate: null,
  },
];
function artwork(colour: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#151b22"/><circle cx="150" cy="150" r="92" fill="${colour}" opacity=".65"/><path d="M0 210L300 90M0 250L300 130" stroke="#99e8ef" opacity=".3" stroke-width="2"/></svg>`)}`;
}
export function TracksCheckpoint() {
  const [active, setActive] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(60);
  const duration = tracks
    .find((track) => track.id === active)!
    .duration.split(":")
    .reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0);
  const playback = useRef({ playing, duration });
  playback.current = { playing, duration };
  // A local one-second demonstration clock; it never opens a player or connection.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (playback.current.playing)
        setPosition((value) => Math.min(playback.current.duration, value + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [density, setDensity] = useState("default");
  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState<number[]>([]);
  const [outcome, setOutcome] = useState("Sin acciones en la muestra.");
  function activate(id: number) {
    if (id !== active) setPosition(0);
    setPlaying(id === active ? !playing : true);
    setActive(id);
    setOutcome(
      `Reproducción de muestra: ${tracks.find((track) => track.id === id)!.title}.`,
    );
  }
  return (
    <section
      id="pistas"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1S, Pistas y portadas"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="20">
            Checkpoint 1S · En revisión
          </MonoLabel>
          <h2>La música, en su sitio.</h2>
        </div>
        <p>
          Una fila estable para escuchar. Portadas sin elevación, cifras en mono
          y acciones que también responden al teclado.
        </p>
      </div>
      <div className="crate-form-field max-w-md">
        <MonoLabel as="div" id="track-density-label">
          Densidad de la muestra
        </MonoLabel>
        <SegmentedControl
          as="radio"
          label="Densidad de la muestra"
          aria-label="Densidad de la muestra"
          value={density}
          onValueChange={setDensity}
          items={[
            { value: "default", label: "Cómoda" },
            { value: "compact", label: "Compacta" },
          ]}
        />
      </div>
      <figure className="m-0 mt-10" aria-label="Filas de Listen">
        <figcaption>
          <MonoLabel>Listen · Filas y control real de reproducción</MonoLabel>
        </figcaption>
        <div className="crate-form-field max-w-md mt-5 mb-5">
          <div className="flex items-baseline justify-between gap-4">
            <MonoLabel>Posición de muestra</MonoLabel>
            <span className="crate-media-meta text-text-muted">
              {formatPlayerTime(position)} / {formatPlayerTime(duration)}
            </span>
          </div>
          <I18nextProvider i18n={samplePlayerI18n}>
            <PlayerSeekBar
              currentTime={position}
              duration={duration}
              onSeek={setPosition}
              variant="glow"
              thin={density === "compact"}
            />
          </I18nextProvider>
        </div>
        <TrackList
          className="mt-5"
          label="Canciones de muestra"
          items={tracks}
          itemKey={(track) => track.id}
          renderRow={(track, index) => (
            <div
              role="group"
              aria-label={track.title}
              tabIndex={0}
              data-active={track.id === active}
              aria-current={track.id === active ? "true" : undefined}
              data-density={density}
              className={`track-row group flex items-center gap-[var(--content-row-gap)] ${density === "compact" ? "px-2 py-1.5" : "px-3 py-[var(--content-row-padding-y)]"}`}
              onClick={(event) => {
                if (
                  !(event.target as HTMLElement).closest(
                    "button,[role=menuitem]",
                  )
                )
                  activate(track.id);
              }}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  ["Enter", " "].includes(event.key)
                ) {
                  event.preventDefault();
                  activate(track.id);
                }
              }}
            >
              <TrackRowContent
                leading={
                  <TrackRowPlaybackControl
                    index={index + 1}
                    disabled={false}
                    isActive={track.id === active}
                    isPlaying={playing}
                    activeGlyph={
                      track.id === active ? (
                        <TrackRowPlaybackProgressView
                          isPlaying={playing}
                          currentTime={position}
                          duration={duration}
                        />
                      ) : undefined
                    }
                    label={`${track.id === active && playing ? "Pausar" : "Reproducir"} ${track.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      activate(track.id);
                    }}
                  />
                }
                title={track.title}
                details={
                  <div className="truncate text-xs text-text-muted">
                    {track.artist}
                  </div>
                }
                explicitLabel={
                  track.id === 2 ? "Contenido explícito" : undefined
                }
                quality={formatTrackQuality(
                  track.format,
                  track.depth,
                  track.rate,
                )}
                analysis={formatTrackAnalysis(
                  track.bpm,
                  track.key,
                  track.scale,
                )}
                duration={track.duration}
                like={
                  <FollowHeartButton
                    className="crate-track-action size-9 shrink-0"
                    following={liked.includes(track.id)}
                    label={`Me gusta ${track.title}`}
                    labelActive={`Quitar me gusta ${track.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setLiked((previous) =>
                        previous.includes(track.id)
                          ? previous.filter((id) => id !== track.id)
                          : [...previous, track.id],
                      );
                    }}
                  />
                }
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="crate-track-action"
                        aria-label={`Acciones de ${track.title}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        ···
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          setOutcome(
                            `Añadida a la cola de muestra: ${track.title}.`,
                          )
                        }
                      >
                        Añadir a la cola de muestra
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </div>
          )}
        />
        <p className="mt-4 text-sm text-text-muted">
          La pista actual mantiene la misma altura. Las lecturas ausentes no se
          inventan. El halo y el anillo siguen el reloj local de muestra, sin
          audio. En móvil, los controles tienen un área de al menos 44 px.
        </p>
      </figure>
      <MemoryRouter>
        <figure className="m-0 mt-12" aria-label="Portadas compartidas">
          <figcaption>
            <MonoLabel>Rejilla compartida · Álbumes y artistas</MonoLabel>
          </figcaption>
          <MediaGrid className="mt-5" density="wide">
            <EntityCard
              actionMenu={{
                getActions: () => [
                  {
                    key: "sample",
                    label: "Ver ficha de muestra",
                    onSelect: () => setOutcome("Ficha de muestra abierta."),
                  },
                ],
              }}
              title="Luz de octubre"
              subtitle="Costa Norte"
              meta="2019 · LP"
              layout="grid"
              cover={{
                src: artwork("#2c8a98"),
                alt: "Portada ficticia de Luz de octubre",
              }}
              onOpen={() => setOutcome("Álbum de muestra abierto.")}
              overlay={{
                onPlay: () => setOutcome("Álbum de muestra en reproducción."),
                playLabel: "Reproducir Luz de octubre",
                follow: {
                  following: saved,
                  label: "Guardar Luz de octubre",
                  labelActive: "Luz de octubre guardado",
                  onToggle: () => setSaved(!saved),
                },
              }}
            />
            <EntityCard
              title="Una habitación tranquila"
              subtitle="2022 · EP"
              meta="Portada sin imagen"
              layout="grid"
              cover={{ alt: "Una habitación tranquila" }}
              onOpen={() => setOutcome("Álbum sin portada abierto.")}
              overlay={{
                onPlay: () =>
                  setOutcome("Segundo álbum de muestra en reproducción."),
                playLabel: "Reproducir Una habitación tranquila",
              }}
            />
            <EntityCard
              title="Costa Norte"
              subtitle="4 álbumes"
              shape="circle"
              layout="grid"
              cover={{
                src: artwork("#48746c"),
                alt: "Retrato ficticio de Costa Norte",
              }}
              onOpen={() => setOutcome("Artista de muestra abierto.")}
              overlay={{
                onPlay: () => setOutcome("Artista de muestra en reproducción."),
                playLabel: "Reproducir Costa Norte",
              }}
            />
          </MediaGrid>
        </figure>
      </MemoryRouter>
      <figure className="m-0 mt-12" aria-label="Tabla de Admin">
        <figcaption>
          <MonoLabel>Admin · Tabla y metadatos compartidos</MonoLabel>
        </figcaption>
        <div className="crate-track-table-frame mt-5">
          <Table className="crate-track-table" aria-label="Pistas de Admin">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Pista</TableHead>
                <TableHead className="crate-table-secondary">Formato</TableHead>
                <TableHead className="crate-table-detail crate-table-number">
                  Bitrate
                </TableHead>
                <TableHead className="crate-table-number">Duración</TableHead>
                <TableHead className="crate-table-secondary">
                  BPM · Key
                </TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...tracks, ...tracks, ...tracks, ...tracks].map(
                (track, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-xs tabular-nums text-text-subtle">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-48 truncate text-sm font-medium">
                        {track.title}
                      </div>
                      <div className="max-w-48 truncate text-xs text-text-muted">
                        {track.artist}
                      </div>
                    </TableCell>
                    <TableCell className="crate-table-secondary">
                      <span className="crate-track-quality">
                        {formatTrackQuality(
                          track.format,
                          track.depth,
                          track.rate,
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="crate-table-detail font-mono text-xs tabular-nums">
                      950
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {track.duration}
                    </TableCell>
                    <TableCell className="crate-table-secondary">
                      <span className="crate-track-analysis">
                        {formatTrackAnalysis(
                          track.bpm,
                          track.key,
                          track.scale,
                        ) ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="crate-track-action"
                        aria-label={`Descargar muestra ${index + 1}`}
                        onClick={() =>
                          setOutcome(
                            "Descarga de muestra solicitada. No se genera un archivo.",
                          )
                        }
                      >
                        Descargar
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-4 text-sm text-text-muted">
          Cabecera fija sobre el lienzo y columnas que se reducen a 1000 y 760
          px. La tabla de gestión conserva sus acciones.
        </p>
      </figure>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <PlayButton
          size="sm"
          label="Probar play pequeño"
          onClick={() => setOutcome("Control pequeño activado.")}
        />
        <PlayButton
          size="lg"
          label="Probar play grande"
          onClick={() => setOutcome("Control grande activado.")}
        />
        <div className="crate-form-field min-w-0 flex-1">
          <MonoLabel id="track-outcome-label">
            Última acción de la muestra
          </MonoLabel>
          <p
            aria-labelledby="track-outcome-label"
            role="status"
            className="m-0 text-sm text-text-muted"
          >
            {outcome}
          </p>
        </div>
      </div>
      <p className="mt-10 text-sm text-text-muted">
        Datos y acciones de muestra. TrackList, MediaGrid, EntityCard,
        PlayButton y el control de fila de Listen son componentes reales. Esta
        sección no consulta la biblioteca ni guarda preferencias.
      </p>
    </section>
  );
}
