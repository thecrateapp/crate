import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  cutAt,
  sourceTime,
  type ActiveCut,
  type Cut,
  type Pose,
  type ShotEdit,
  type Source,
} from "../film/edit";
import { positionAt, type BeatGrid } from "../film/grid";
import { sectionAt, type Storyboard } from "../film/storyboard";
import { DISPLAY, MONO, useFilmFonts } from "./fonts";
import { frameAt, type Frame } from "./frames";

export type FilmProps = {
  board: Storyboard;
  grid: BeatGrid;
  edit: ShotEdit[];
  takes: Record<string, Frame[]>;
};

export const BG = "#0a0a0f";
const FG = "#f1f5f9";
const FG2 = "rgba(241, 245, 249, 0.62)";
const CYAN = "#06b6d4";
const CYAN_HI = "#67e8f9";
const DESKTOP = { width: 2880, height: 1800 };
const PHONE = { width: 1170, height: 2532 };
const EASE = Easing.bezier(0.16, 1, 0.3, 1);

interface Stage {
  vertical: boolean;
  width: number;
  height: number;
}

function mixPose(from: Pose, to: Pose, amount: number): Pose {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return {
    rotateX: mix(from.rotateX, to.rotateX),
    rotateY: mix(from.rotateY, to.rotateY),
    scale: mix(from.scale, to.scale),
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
  };
}

export function Shot({
  film,
  source,
  takes,
  local,
}: {
  film: string;
  source: Source;
  takes: FilmProps["takes"];
  local: number;
}) {
  const file = frameAt(
    takes[`${source.take}/${source.device}`] ?? [],
    sourceTime(source, local),
  );
  if (!file) return null;
  return (
    <Img
      src={staticFile(
        `takes/${film}/${source.take}/${source.device}/frames/${file}`,
      )}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

export function Desktop({
  width,
  children,
  style,
}: {
  width: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height: (width * DESKTOP.height) / DESKTOP.width,
        borderRadius: 18,
        overflow: "hidden",
        background: "#0b0b0c",
        boxShadow:
          "0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.09)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Phone({
  height,
  children,
  style,
}: {
  height: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const bezel = height * 0.012;
  return (
    <div
      style={{
        height,
        width: (height * PHONE.width) / PHONE.height + bezel * 2,
        padding: bezel,
        borderRadius: height * 0.065,
        background: "#121216",
        boxShadow:
          "0 50px 140px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.12)",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: height * 0.055,
          overflow: "hidden",
          background: BG,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Devices({
  film,
  active,
  stage,
  takes,
}: {
  film: string;
  active: ActiveCut;
  stage: Stage;
  takes: FilmProps["takes"];
}) {
  const { cut, local, progress } = active;
  const eased = EASE(progress);
  const desktop = cut.sources.find((source) => source.device === "desktop");
  const mobile = cut.sources.find((source) => source.device === "mobile");
  const shot = (source: Source) => (
    <Shot film={film} source={source} takes={takes} local={local} />
  );

  if (cut.layout === "desktop" && desktop)
    return (
      <Desktop width={stage.vertical ? 980 : 1560}>{shot(desktop)}</Desktop>
    );
  if (cut.layout === "phone" && mobile)
    return <Phone height={stage.vertical ? 1120 : 900}>{shot(mobile)}</Phone>;
  if (cut.layout === "duo" && desktop && mobile) {
    return stage.vertical ? (
      <div style={{ position: "relative", width: 980, height: 1200 }}>
        <Desktop width={980} style={{ position: "absolute", top: 0, left: 0 }}>
          {shot(desktop)}
        </Desktop>
        <Phone
          height={760}
          style={{
            position: "absolute",
            right: 30,
            bottom: 0,
            transform: "translateZ(90px)",
          }}
        >
          {shot(mobile)}
        </Phone>
      </div>
    ) : (
      <div
        style={{
          position: "relative",
          width: 1680,
          height: 900,
          transformStyle: "preserve-3d",
        }}
      >
        <Desktop
          width={1380}
          style={{ position: "absolute", left: 0, top: 30 }}
        >
          {shot(desktop)}
        </Desktop>
        <Phone
          height={820}
          style={{
            position: "absolute",
            right: 0,
            top: 40,
            transform: "translateZ(120px)",
          }}
        >
          {shot(mobile)}
        </Phone>
      </div>
    );
  }
  return null;
}

function Waveform({
  grid,
  progress,
  stage,
}: {
  grid: BeatGrid;
  progress: number;
  stage: Stage;
}) {
  const bars = grid.energy;
  const width = stage.width * 0.8;
  const visible = Math.ceil(progress * 1.4 * bars.length);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        width,
        height: 260,
      }}
    >
      {bars.map((energy, index) => (
        <div
          key={index}
          style={{
            flex: 1,
            height: `${Math.max(6, energy * 100)}%`,
            borderRadius: 4,
            background:
              index % grid.beatsPerBar === 0
                ? CYAN_HI
                : "rgba(103,232,249,0.45)",
            opacity: index < visible ? 1 : 0.08,
          }}
        />
      ))}
    </div>
  );
}

function Caption({
  cut,
  enter,
  stage,
  centered,
}: {
  cut: Cut;
  enter: number;
  stage: Stage;
  centered: boolean;
}) {
  const text = cut.caption;
  const eyebrow = cut.eyebrow;
  if (!text && !eyebrow) return null;
  return (
    <>
      {centered ? null : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(to top, rgba(10,10,15,${
              0.85 * enter
            }) 0%, rgba(10,10,15,${0.5 * enter}) 22%, transparent 45%)`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: centered ? 0 : stage.vertical ? 64 : 120,
          right: centered ? 0 : undefined,
          bottom: centered ? undefined : stage.vertical ? 120 : 110,
          top: centered ? (cut.card === "waveform" ? "62%" : "50%") : undefined,
          textAlign: centered ? "center" : "left",
          transform: `translateY(${(centered ? -50 : 0) + (1 - enter) * 40}%)`,
          opacity: enter,
        }}
      >
        {eyebrow ? (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 24,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: CYAN_HI,
              marginBottom: 14,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        {text ? (
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: centered
                ? stage.vertical
                  ? 190
                  : 230
                : stage.vertical
                  ? 110
                  : 128,
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
              color: FG,
              textShadow: "0 12px 60px rgba(0,0,0,0.85)",
            }}
          >
            {text}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function Film({ board, grid, edit, takes }: FilmProps) {
  useFilmFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const stage: Stage = { vertical: height > width, width, height };
  const time = frame / fps;
  const active = cutAt(board, edit, grid, time);
  const { cut } = active;
  const position = positionAt(grid, time);
  const section = sectionAt(board, position.bar).name;
  const enter = spring({
    frame: Math.round(active.local * fps),
    fps,
    config: { damping: 18, stiffness: 170 },
  });
  const punch =
    section === "Drop" ? 0.018 * (1 - position.beatProgress) ** 3 : 0;
  const pose = cut.move
    ? mixPose(cut.move[0], cut.move[1], EASE(active.progress))
    : { rotateX: 0, rotateY: 0, scale: 1, x: 0, y: 0 };
  const settle = interpolate(active.local * fps, [0, 5], [1.035, 1], {
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const card = cut.layout === "card";

  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Audio src={staticFile(`${grid.id}.wav`)} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at 30% 20%, rgba(6,182,212,${
            card ? 0.08 : 0.16
          }), transparent 70%), radial-gradient(50% 40% at 80% 90%, rgba(103,232,249,0.08), transparent 70%)`,
        }}
      />
      {!card ? (
        <AbsoluteFill
          style={{
            perspective: 2400,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              transformStyle: "preserve-3d",
              transform: `translate(${pose.x}px, ${pose.y}px) rotateX(${
                pose.rotateX
              }deg) rotateY(${pose.rotateY}deg) scale(${
                pose.scale * settle * (1 + punch)
              })`,
            }}
          >
            <Devices
              film={board.id}
              active={active}
              stage={stage}
              takes={takes}
            />
          </div>
        </AbsoluteFill>
      ) : null}
      {card && cut.card === "waveform" ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: stage.vertical ? 520 : 420,
          }}
        >
          <Waveform grid={grid} progress={active.progress} stage={stage} />
        </AbsoluteFill>
      ) : null}
      {card && cut.card === "end" ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            gap: 48,
            flexDirection: "column",
          }}
        >
          <Img
            src={staticFile("logo.svg")}
            style={{
              width: 200,
              transform: `scale(${0.7 + 0.3 * enter})`,
              opacity: enter,
            }}
          />
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: stage.vertical ? 120 : 150,
              letterSpacing: "-0.04em",
              color: FG,
              opacity: enter,
            }}
          >
            {cut.caption}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 30,
              letterSpacing: "0.2em",
              color: FG2,
              opacity: interpolate(active.local, [0.6, 1.2], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            CRATEMUSIC.APP
          </div>
        </AbsoluteFill>
      ) : null}
      {cut.card === "end" ? null : (
        <Caption cut={cut} enter={enter} stage={stage} centered={card} />
      )}
      {card && cut.card === "word" ? (
        <AbsoluteFill
          style={{
            background: `rgba(6,182,212,${0.05 * (1 - position.beatProgress)})`,
          }}
        />
      ) : null}
      {card ? (
        <div
          style={{
            position: "absolute",
            top: 40,
            right: stage.vertical ? 48 : 64,
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: "0.16em",
            color: "rgba(241,245,249,0.35)",
          }}
        >
          <span style={{ color: CYAN }}>CRATE</span> / {board.id.toUpperCase()}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
