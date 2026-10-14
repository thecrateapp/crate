import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
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
import { localTime, type Knots } from "./sync";

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
  knots: Knots;
};

export type ChapterProps = {
  chapter: ChapterId;
  desktop: Track;
  mobile: Track | null;
};

export const STAGE = { width: 1920, height: 1200 };
const WINDOW = { left: 56, top: 118, width: 1372, chrome: 36 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const WINDOW_HEIGHT =
  WINDOW.chrome +
  (WINDOW.width * DESKTOP_VIEWPORT.height) / DESKTOP_VIEWPORT.width;
const PHONE = { right: 56, height: 860, radius: 50, bezel: 10 };
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const fontHandle = delayRender("Loading JetBrains Mono");
new FontFace(
  "JetBrains Mono",
  `url(${staticFile("fonts/jetbrains-mono-latin-500-normal.woff2")})`,
  { weight: "500" },
)
  .load()
  .then((font) => {
    document.fonts.add(font);
    continueRender(fontHandle);
  })
  .catch((error) => cancelRender(error));

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
  const file = frameAt(track.frames, localTime(track.knots, time));
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
        borderRadius: 14,
        overflow: "hidden",
        background: "#0b0b0c",
        boxShadow:
          "0 40px 120px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08)",
      }}
    >
      <div
        style={{
          position: "relative",
          height: WINDOW.chrome,
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingLeft: 14,
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
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
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 14,
            letterSpacing: "0.08em",
            color: "rgba(255, 255, 255, 0.45)",
          }}
        >
          Crate
        </span>
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
  const file = frameAt(track.frames, localTime(track.knots, time));
  const tap = cursorAt(track.events, time, {
    x: viewport.width / 2,
    y: viewport.height / 2,
  });

  return (
    <div
      style={{
        position: "absolute",
        right: PHONE.right,
        top: WINDOW.top + (WINDOW_HEIGHT - PHONE.height) / 2,
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
              left: tap.x * scale - 22,
              top: tap.y * scale - 22,
              width: 44,
              height: 44,
              borderRadius: 22,
              background: "rgba(255, 255, 255, 0.35)",
              border: "2px solid rgba(255, 255, 255, 0.7)",
              opacity: tap.pulse,
              transform: `scale(${1.4 - tap.pulse * 0.4})`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export function Chapter({ chapter, desktop, mobile }: ChapterProps) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const time = frame / fps;
  const number = `0${CHAPTERS.indexOf(chapter) + 1}`;

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(80% 70% at 50% 40%, rgba(6, 182, 212, 0.08), transparent 70%), #0d0e14",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: STAGE.width,
          height: STAGE.height,
          transformOrigin: "0 0",
          transform: `scale(${width / STAGE.width})`,
        }}
      >
        <Desktop chapter={chapter} track={desktop} time={time} />
        {mobile && <Phone chapter={chapter} track={mobile} time={time} />}
        <p
          style={{
            position: "absolute",
            left: WINDOW.left,
            bottom: 72,
            margin: 0,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.72)",
          }}
        >
          <span style={{ color: "#67e8f9" }}>{number}</span> /{" "}
          {en[`screencast.${chapter}`]}
        </p>
      </div>
    </AbsoluteFill>
  );
}
