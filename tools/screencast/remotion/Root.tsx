import {
  Composition,
  staticFile,
  type CalculateMetadataFunction,
} from "remotion";
import { Chapter, CHAPTERS, type ChapterProps, type Track } from "./Chapter";
import type { Frame } from "./frames";
import { syncTracks } from "./sync";

const FPS = 30;
const TAIL_SECONDS = 1;

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
