import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DISPLAY, MONO, useFilmFonts } from "./fonts";
import { barTime, beatLength, positionAt, type BeatGrid } from "../film/grid";
import {
  sectionAt,
  shotAt,
  type Cadence,
  type Shot,
  type Storyboard,
} from "../film/storyboard";

export type AnimaticProps = {
  board: Storyboard;
  grid: BeatGrid;
};

const BG = "#0a0a0f";
const FG = "#f1f5f9";
const FG2 = "rgba(241, 245, 249, 0.62)";
const FG3 = "rgba(241, 245, 249, 0.5)";
const LINE = "rgba(241, 245, 249, 0.1)";
const CYAN = "#06b6d4";
const CYAN_HI = "#67e8f9";
const AMBER = "#fbbf24";

const SECTION_COLORS: Record<string, string> = {
  Breakdown: "rgba(6, 182, 212, 0.25)",
  Build: "rgba(6, 182, 212, 0.5)",
  Tension: "rgba(6, 182, 212, 0.5)",
  Silence: "rgba(241, 245, 249, 0.08)",
  Stop: "rgba(241, 245, 249, 0.08)",
  Full: "rgba(251, 191, 36, 0.55)",
  Drop: "rgba(251, 191, 36, 0.55)",
  Hit: "rgba(103, 232, 249, 0.8)",
};

const CADENCE_BEATS: Record<Cadence, number> = { bar: 4, half: 2, beat: 1 };

const CAMERA = [
  { rotateY: -14, rotateX: 6, scale: 1, x: 0 },
  { rotateY: 10, rotateX: 4, scale: 1.18, x: -60 },
  { rotateY: 0, rotateX: 12, scale: 1.32, x: 40 },
  { rotateY: -6, rotateX: 0, scale: 1.08, x: 80 },
];

function Device({
  kind,
  shot,
  cut,
}: {
  kind: "desktop" | "mobile";
  shot: Shot;
  cut: number;
}) {
  const desktop = kind === "desktop";
  return (
    <div
      style={{
        width: desktop ? 920 : 250,
        height: desktop ? 575 : 520,
        borderRadius: desktop ? 14 : 40,
        border: `2px solid ${
          desktop ? "rgba(103, 232, 249, 0.55)" : "rgba(251, 191, 36, 0.6)"
        }`,
        background:
          "linear-gradient(160deg, rgba(241,245,249,0.06), rgba(241,245,249,0.015))",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: desktop ? 28 : 22,
        boxSizing: "border-box",
        fontFamily: MONO,
        color: FG2,
        fontSize: desktop ? 20 : 15,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span>{kind}</span>
      <span
        style={{
          fontFamily: DISPLAY,
          fontSize: desktop ? 64 : 30,
          color: FG,
          textTransform: "none",
          letterSpacing: 0,
          fontWeight: 650,
        }}
      >
        {shot.title}
      </span>
      <span style={{ color: CYAN_HI }}>
        {shot.cadence ? `cut ${cut + 1}` : "hold"}
      </span>
    </div>
  );
}

export function Animatic({ board, grid }: AnimaticProps) {
  useFilmFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const time = frame / fps;
  const position = positionAt(grid, time);
  const shot = shotAt(board, position.bar);
  const section = sectionAt(board, position.bar);
  const beat = beatLength(grid);
  const shotStart = barTime(grid, shot.bar);
  const shotEnd = barTime(grid, shot.bar + shot.bars);
  const step = CADENCE_BEATS[shot.cadence ?? "bar"] * beat;
  const cut = shot.cadence ? Math.floor((time - shotStart) / step + 1e-6) : 0;
  const cutStart = shotStart + cut * step;
  const camera = CAMERA[cut % CAMERA.length];
  const dolly = interpolate(time, [shotStart, shotEnd], [1, 1.08]);
  const flash = interpolate(
    time - cutStart,
    [0, 2 / fps, 5 / fps],
    [0.5, 0.25, 0],
    { extrapolateRight: "clamp" },
  );
  const enter = spring({
    frame: Math.round((time - shotStart) * fps),
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  const pulse = 1 - position.beatProgress;
  const vertical = height > width;

  return (
    <AbsoluteFill style={{ background: BG, color: FG, fontFamily: MONO }}>
      <Audio src={staticFile(`${grid.id}.wav`)} />

      <div
        style={{
          position: "absolute",
          top: 40,
          left: 56,
          right: 56,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 20,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: FG3,
          gap: 24,
        }}
      >
        <span>
          <b style={{ color: CYAN }}>Crate</b> / {board.id} film / animatic
        </span>
        {!vertical && (
          <span>
            {grid.artist} — {grid.title} · {grid.bpm.toFixed(1)} BPM
          </span>
        )}
      </div>

      <AbsoluteFill
        style={{
          perspective: 1800,
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: vertical ? 260 : 180,
        }}
      >
        {shot.devices.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: vertical ? "column" : "row",
              alignItems: "center",
              gap: 48,
              transform: `translateX(${camera.x}px) rotateY(${
                camera.rotateY
              }deg) rotateX(${camera.rotateX}deg) scale(${
                camera.scale * dolly * (vertical ? 0.62 : 1)
              })`,
              transformStyle: "preserve-3d",
              opacity: 0.4 + 0.6 * enter,
            }}
          >
            {shot.devices.map((device) => (
              <Device key={device} kind={device} shot={shot} cut={cut} />
            ))}
          </div>
        ) : null}
        {shot.caption && (
          <div
            style={{
              position: shot.devices.length ? "absolute" : "relative",
              bottom: shot.devices.length ? (vertical ? 420 : 300) : undefined,
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: shot.devices.length ? 72 : vertical ? 120 : 150,
              letterSpacing: "-0.03em",
              transform: `scale(${0.85 + 0.15 * enter})`,
              opacity: enter,
              textShadow: "0 8px 40px rgba(0,0,0,0.8)",
              textAlign: "center",
              padding: "0 40px",
            }}
          >
            {shot.caption}
          </div>
        )}
      </AbsoluteFill>

      <AbsoluteFill
        style={{ background: FG, opacity: flash, pointerEvents: "none" }}
      />

      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: vertical ? 300 : 196,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 32,
        }}
      >
        <div style={{ maxWidth: vertical ? 620 : 1100 }}>
          <div
            style={{
              fontSize: 22,
              color: AMBER,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {section.name} · {shot.title}
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: vertical ? 26 : 30,
              color: FG2,
              lineHeight: 1.3,
            }}
          >
            {shot.detail}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{
                  width: n === 1 ? 26 : 18,
                  height: n === 1 ? 26 : 18,
                  borderRadius: 99,
                  background:
                    n === position.beat ? (n === 1 ? AMBER : CYAN_HI) : LINE,
                  transform: `scale(${
                    n === position.beat ? 1 + 0.5 * pulse : 1
                  })`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 34, letterSpacing: "0.06em", color: FG }}>
            BAR {position.bar} · {position.beat}
          </div>
        </div>
      </div>

      <Timeline board={board} grid={grid} time={time} vertical={vertical} />
    </AbsoluteFill>
  );
}

function Timeline({
  board,
  grid,
  time,
  vertical,
}: AnimaticProps & { time: number; vertical: boolean }) {
  const left = 56;
  const span = (vertical ? 1080 : 1920) - left * 2;
  const x = (seconds: number) => (seconds / grid.duration) * span;
  const beat = beatLength(grid);
  return (
    <div
      style={{
        position: "absolute",
        left,
        bottom: vertical ? 90 : 48,
        width: span,
        height: vertical ? 170 : 120,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 10,
          display: "flex",
        }}
      >
        {board.sections.map((section) => (
          <div
            key={section.bar}
            style={{
              width: x(section.bars * grid.beatsPerBar * beat),
              background: SECTION_COLORS[section.name] ?? LINE,
              borderRight: `2px solid ${BG}`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 0,
          right: 0,
          height: 46,
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        {grid.energy.map((energy, index) => (
          <div
            key={index}
            style={{
              width: x(beat),
              height: Math.max(2, energy * 46),
              background:
                index % grid.beatsPerBar === 0
                  ? "rgba(241,245,249,0.38)"
                  : "rgba(241,245,249,0.18)",
              borderRight: `1px solid ${BG}`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 0,
          right: 0,
          height: vertical ? 90 : 40,
          display: "flex",
        }}
      >
        {board.shots.map((shot) => (
          <div
            key={shot.bar}
            style={{
              width: x(shot.bars * grid.beatsPerBar * beat),
              borderLeft: `2px solid ${CYAN}`,
              paddingLeft: 6,
              fontSize: 13,
              color: FG3,
              overflow: "hidden",
              whiteSpace: vertical ? "normal" : "nowrap",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {shot.title}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: -6,
          bottom: -6,
          left: x(time),
          width: 3,
          background: AMBER,
        }}
      />
    </div>
  );
}
