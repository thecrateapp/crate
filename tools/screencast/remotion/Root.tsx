import {
  Composition,
  staticFile,
  type CalculateMetadataFunction,
} from "remotion";
import admin from "../film/data/admin.beats.json";
import listen from "../film/data/listen.beats.json";
import type { BeatGrid } from "../film/grid";
import { ADMIN, LISTEN } from "../film/storyboard";
import { takesIn, type ShotEdit } from "../film/edit";
import { ADMIN_EDIT } from "../film/edits/admin";
import { LISTEN_EDIT } from "../film/edits/listen";
import { GALLERY, galleryTakes } from "../film/gallery";
import { Animatic } from "./Animatic";
import { Gallery, type GalleryProps } from "./Gallery";
import { Film, type FilmProps } from "./Film";
import { Chapter, CHAPTERS, type ChapterProps, type Track } from "./Chapter";
import type { Frame } from "./frames";
import { syncTracks } from "./sync";

const FPS = 30;
const TAIL_SECONDS = 1;

const FILMS: { board: FilmProps["board"]; grid: BeatGrid; edit: ShotEdit[] }[] =
  [
    { board: LISTEN, grid: listen as BeatGrid, edit: LISTEN_EDIT },
    { board: ADMIN, grid: admin as BeatGrid, edit: ADMIN_EDIT },
  ];

const loadTakes: CalculateMetadataFunction<FilmProps> = async ({
  props,
  abortSignal,
}) => {
  const entries = await Promise.all(
    takesIn(props.edit).map(async (key) => {
      const response = await fetch(
        staticFile(`takes/${props.board.id}/${key}/frames.json`),
        { signal: abortSignal },
      );
      if (!response.ok)
        throw new Error(
          `Missing out/film/takes/${props.board.id}/${key}; capture it first.`,
        );
      return [key, (await response.json()) as Frame[]] as const;
    }),
  );
  return { props: { ...props, takes: Object.fromEntries(entries) } };
};

const loadGalleryTakes: CalculateMetadataFunction<GalleryProps> = async ({
  props,
  abortSignal,
}) => {
  const entries = await Promise.all(
    galleryTakes(props.gallery).map(async (key) => {
      const response = await fetch(staticFile(`takes/${key}/frames.json`), {
        signal: abortSignal,
      });
      if (!response.ok)
        throw new Error(`Missing out/film/takes/${key}; capture it first.`);
      return [key, (await response.json()) as Frame[]] as const;
    }),
  );
  return { props: { ...props, takes: Object.fromEntries(entries) } };
};

const FORMATS = [
  { id: "16x9", width: 1920, height: 1080 },
  { id: "4x5", width: 1080, height: 1350 },
];

type Capture = Omit<Track, "knots">;

async function loadCapture(
  chapter: string,
  device: "desktop" | "mobile",
  signal: AbortSignal,
): Promise<Capture> {
  const read = async (name: string) => {
    const response = await fetch(staticFile(`${chapter}/${device}/${name}`), {
      signal,
    });
    if (!response.ok)
      throw new Error(
        `Missing out/${chapter}/${device}/${name}; run the capture first.`,
      );
    return response.json();
  };
  const [frames, log] = await Promise.all([
    read("frames.json") as Promise<Frame[]>,
    read("events.json"),
  ]);
  return { frames, events: log.events, viewport: log.viewport };
}

const calculateMetadata: CalculateMetadataFunction<ChapterProps> = async ({
  props,
  abortSignal,
}) => {
  const desktop = await loadCapture(props.chapter, "desktop", abortSignal);
  const mobile = await loadCapture(props.chapter, "mobile", abortSignal).catch(
    () => null,
  );
  const captures = mobile ? [desktop, mobile] : [desktop];
  const synced = syncTracks(
    captures.map((capture) => ({
      events: capture.events,
      end: capture.frames.at(-1)?.t ?? 0,
    })),
  );
  const [desktopTrack, mobileTrack] = captures.map((capture, index) => ({
    ...capture,
    ...synced.tracks[index],
  }));
  return {
    durationInFrames: Math.max(
      1,
      Math.ceil((synced.duration + TAIL_SECONDS) * FPS),
    ),
    props: { ...props, desktop: desktopTrack, mobile: mobileTrack ?? null },
  };
};

const empty: Track = {
  frames: [],
  events: [],
  viewport: { width: 1440, height: 900 },
  knots: { local: [0], timeline: [0] },
};

export function Root() {
  return (
    <>
      <Composition
        id="gallery"
        component={Gallery}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={GALLERY.length}
        defaultProps={{ gallery: GALLERY, takes: {} }}
        calculateMetadata={loadGalleryTakes}
      />
      <Composition
        id="gallery-4x5"
        component={Gallery}
        width={1080}
        height={1350}
        fps={FPS}
        durationInFrames={GALLERY.length}
        defaultProps={{ gallery: GALLERY, takes: {} }}
        calculateMetadata={loadGalleryTakes}
      />
      {FILMS.flatMap(({ board, grid, edit }) =>
        FORMATS.map((format) => (
          <Composition
            key={`${board.id}-film-${format.id}`}
            id={`${board.id}-film-${format.id}`}
            component={Film}
            width={format.width}
            height={format.height}
            fps={FPS}
            durationInFrames={Math.round(grid.duration * FPS)}
            defaultProps={{ board, grid, edit, takes: {} }}
            calculateMetadata={loadTakes}
          />
        )),
      )}
      {FILMS.flatMap(({ board, grid }) =>
        FORMATS.map((format) => (
          <Composition
            key={`${board.id}-animatic-${format.id}`}
            id={`${board.id}-animatic-${format.id}`}
            component={Animatic}
            width={format.width}
            height={format.height}
            fps={FPS}
            durationInFrames={Math.round(grid.duration * FPS)}
            defaultProps={{ board, grid }}
          />
        )),
      )}
      {CHAPTERS.map((chapter) => (
        <Composition
          key={chapter}
          id={chapter}
          component={Chapter}
          width={1280}
          height={800}
          fps={FPS}
          durationInFrames={FPS}
          defaultProps={{ chapter, desktop: empty, mobile: null }}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
}
