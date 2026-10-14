import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { en } from "../../../app/web/src/i18n/en";
import type { CaptureEvent } from "../events";
import { cameraAt } from "./camera";
import { cursorAt } from "./cursor";
import { frameAt, type Frame } from "./frames";

export const CHAPTERS = [
  "library",
  "player",
  "radio",
  "paths",
  "offline",
] as const;
export type ChapterId = (typeof CHAPTERS)[number];

export type Track = {
  frames: Frame[];
  events: CaptureEvent[];
  viewport: { width: number; height: number };
};

export type ChapterProps = {
  chapter: ChapterId;
  desktop: Track;
  mobile: Track | null;
};

const WINDOW = { left: 96, top: 72, width: 1440, chrome: 36 };
const PHONE = { right: 96, bottom: 72, height: 760, radius: 44, bezel: 10 };
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function Desktop({
  chapter,
  track,
  time,
}: {
  chapter: ChapterId;
  track: Track;
  time: number;
}) {
  const { fps } = useVideoConfig();
  const { viewport } = track;
  const scale = WINDOW.width / viewport.width;
  const height = viewport.height * scale;
  const camera = cameraAt(track.events, time, { viewport, fps });
  const cursor = cursorAt(track.events, time, {
    x: viewport.width / 2,
    y: viewport.height / 2,
  });
  const file = frameAt(track.frames, time);
  const transform = `translate(${WINDOW.width / 2}px, ${height / 2}px) scale(${
    scale * camera.zoom
  }) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      style={{
        position: "absolute",
        left: WINDOW.left,
        top: WINDOW.top,
        width: WINDOW.width,
        borderRadius: 12,
        overflow: "hidden",
        background: "#0b0b0c",
        boxShadow:
          "0 40px 120px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08)",
      }}
    >
      <div
        style={{
          height: WINDOW.chrome,
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingLeft: 14,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <span
            key={color}
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: color,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "relative",
          width: WINDOW.width,
          height,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: viewport.width,
            height: viewport.height,
            transformOrigin: "0 0",
            transform,
          }}
        >
          {file && (
            <Img
              src={staticFile(`${chapter}/desktop/frames/${file}`)}
              style={{ width: viewport.width, height: viewport.height }}
            />
          )}
          <Pointer x={cursor.x} y={cursor.y} pulse={cursor.pulse} />
        </div>
      </div>
    </div>
  );
}

function Pointer({ x, y, pulse }: { x: number; y: number; pulse: number }) {
  return (
    <>
      {pulse > 0 && (
        <span
          style={{
            position: "absolute",
            left: x - 24,
            top: y - 24,
            width: 48,
            height: 48,
            borderRadius: 24,
            border: "2px solid rgba(255, 255, 255, 0.9)",
            opacity: pulse,
            transform: `scale(${1.6 - pulse * 0.6})`,
          }}
        />
      )}
      <svg
        width={22}
        height={22}
        viewBox="0 0 22 22"
        style={{ position: "absolute", left: x - 3, top: y - 2 }}
      >
        <path
          d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.5 L10 13 L16 13 Z"
          fill="#fff"
          stroke="#000"
          strokeWidth={1.2}
        />
      </svg>
    </>
  );
}

function Phone({
  chapter,
  track,
  time,
}: {
  chapter: ChapterId;
  track: Track;
  time: number;
}) {
  const { viewport } = track;
  const screenHeight = PHONE.height - PHONE.bezel * 2;
  const scale = screenHeight / viewport.height;
  const screenWidth = viewport.width * scale;
  const file = frameAt(track.frames, time);
  const tap = cursorAt(track.events, time, {
    x: viewport.width / 2,
    y: viewport.height / 2,
  });

  return (
    <div
      style={{
        position: "absolute",
        right: PHONE.right,
        bottom: PHONE.bottom,
        padding: PHONE.bezel,
        borderRadius: PHONE.radius,
        background: "#111",
        boxShadow:
          "0 40px 120px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: screenWidth,
          height: screenHeight,
          borderRadius: PHONE.radius - PHONE.bezel,
          overflow: "hidden",
        }}
      >
        {file && (
          <Img
            src={staticFile(`${chapter}/mobile/frames/${file}`)}
            style={{ width: screenWidth, height: screenHeight }}
          />
        )}
        {tap.pulse > 0 && (
          <span
            style={{
              position: "absolute",
              left: tap.x * scale - 18,
              top: tap.y * scale - 18,
              width: 36,
              height: 36,
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.35)",
              opacity: tap.pulse,
            }}
          />
        )}
      </div>
    </div>
  );
}

export function Chapter({ chapter, desktop, mobile }: ChapterProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const number = `0${CHAPTERS.indexOf(chapter) + 1}`;

  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      <Desktop chapter={chapter} track={desktop} time={time} />
      {mobile && <Phone chapter={chapter} track={mobile} time={time} />}
      <p
        style={{
          position: "absolute",
          left: WINDOW.left,
          bottom: 20,
          margin: 0,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255, 255, 255, 0.72)",
        }}
      >
        {number} / {en[`screencast.${chapter}`]}
      </p>
    </AbsoluteFill>
  );
}
