import {
  Composition,
  staticFile,
  type CalculateMetadataFunction,
} from "remotion";
import { Chapter, CHAPTERS, type ChapterProps, type Track } from "./Chapter";

const FPS = 30;
const TAIL_SECONDS = 1;

async function loadTrack(
  chapter: string,
  device: "desktop" | "mobile",
  signal: AbortSignal,
): Promise<Track> {
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
    read("frames.json"),
    read("events.json"),
  ]);
  return { frames, events: log.events, viewport: log.viewport };
}

const calculateMetadata: CalculateMetadataFunction<ChapterProps> = async ({
  props,
  abortSignal,
}) => {
  const desktop = await loadTrack(props.chapter, "desktop", abortSignal);
  const mobile = await loadTrack(props.chapter, "mobile", abortSignal).catch(
    () => null,
  );
  const end = Math.max(
    desktop.frames.at(-1)?.t ?? 0,
    mobile?.frames.at(-1)?.t ?? 0,
  );
  return {
    durationInFrames: Math.max(1, Math.ceil((end + TAIL_SECONDS) * FPS)),
    props: { ...props, desktop, mobile },
  };
};

const empty: Track = {
  frames: [],
  events: [],
  viewport: { width: 1440, height: 900 },
};

export function Root() {
  return (
    <>
      {CHAPTERS.map((chapter) => (
        <Composition
          key={chapter}
          id={chapter}
          component={Chapter}
          width={1920}
          height={1080}
          fps={FPS}
          durationInFrames={FPS}
          defaultProps={{ chapter, desktop: empty, mobile: null }}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
}
