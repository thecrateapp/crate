import { useLayoutEffect, useRef, useState } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import {
  STEMS,
  type LanePhrase,
  type LayerPhrase,
  type StemName,
} from "./stems-model";
import "./stem-lanes.css";

const STEM_LABELS: Record<StemName, string> = {
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  vocals: "Vocals",
};

// The approved mockup's geometry (Smart Mix stems, 2026-11-09). The drawing takes the
// container's pixel width, so labels keep the MonoLabel size and one pixel column is one
// slice of the track.
const X0 = 104;
const VALUE_GUTTER = 96;
const TOP = 6;
const LANE_HEIGHT = 62;
const LANE_GAP = 16;

function round(value: number) {
  return Number(value.toFixed(1));
}

export function clock(ms: number, tenths = true) {
  const seconds = ((ms % 60_000) / 1_000)
    .toFixed(tenths ? 1 : 0)
    .padStart(tenths ? 4 : 2, "0");
  return `${Math.floor(ms / 60_000)}:${seconds}`;
}

export function db(byte: number) {
  return Math.round((byte * 60) / 255 - 60);
}

export function dbText(byte: number) {
  const value = db(byte);
  return value <= -60 ? "≤ −60" : `${value < 0 ? "−" : ""}${Math.abs(value)}`;
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

/** The highest level of the windows under each pixel column of the plot. */
function envelope(levels: number[], hopMs: number, span: number, plot: number) {
  const columns: number[] = [];
  for (let column = 0; column < plot; column += 1) {
    const from = Math.floor(((column / plot) * span) / hopMs);
    const to = Math.max(
      from + 1,
      Math.floor((((column + 1) / plot) * span) / hopMs),
    );
    let high = 0;
    for (let index = from; index < Math.min(to, levels.length); index += 1) {
      high = Math.max(high, levels[index] ?? 0);
    }
    columns.push(high);
  }
  return columns;
}

function phraseDescription(phrase: LanePhrase) {
  return `${phrase.kind}, ${phrase.bars} bars, ${clock(phrase.startMs)} to ${clock(
    phrase.endMs,
  )}`;
}

/** The Phrases tab's own strip (HTML and MonoLabels), over the plot columns. */
function PhraseStrip({
  phrases,
  x,
  lastEnd,
  plot,
}: {
  phrases: LanePhrase[];
  x: (ms: number) => number;
  lastEnd: number;
  plot: number;
}) {
  const pct = (ms: number) => round(((x(ms) - X0) / plot) * 100);
  return (
    <div className="stem-lanes-strip" style={{ marginLeft: X0, width: plot }}>
      <ol aria-label="Phrases" className="relative m-0 h-10 list-none p-0">
        {phrases.map((phrase, index) => (
          <TooltipHint
            key={`${phrase.startMs}:${index}`}
            content={phraseDescription(phrase)}
          >
            <li
              tabIndex={0}
              aria-label={phraseDescription(phrase)}
              data-kind={phrase.kind}
              data-row={index % 2}
              className="absolute h-1/2 min-w-0 overflow-hidden border-l border-border-quiet pl-1 text-ellipsis whitespace-nowrap"
              style={{
                top: index % 2 ? "50%" : "0",
                left: `${pct(phrase.startMs)}%`,
                width: `${round(
                  pct(phrases[index + 2]?.startMs ?? lastEnd) -
                    pct(phrase.startMs),
                )}%`,
              }}
            >
              <MonoLabel
                as="span"
                tone={phrase.kind === "peak" ? "accent" : "subtle"}
              >
                {phrase.kind} · {phrase.bars}
              </MonoLabel>
            </li>
          </TooltipHint>
        ))}
      </ol>
    </div>
  );
}

export interface StemLanesProps {
  durationMs: number;
  phrases: LanePhrase[];
  levels: Record<StemName, number[]> | null;
  hopMs?: number;
  layer: LayerPhrase[] | null;
  drumBeatsMs: number[] | null;
  voiceDetector?: string | null;
  stale?: boolean;
  emptyMessage?: string;
}

/**
 * One lane per stem on the track's time axis, in the language of the sound spectrum:
 * the 250 ms level as a crest with fill and glow, each phrase's mean (the stems layer
 * the planner reads) as a lit bar, and the track's mean on the right. "Other" is drawn
 * in a neutral tone: neither the planner nor the server's stem file uses it.
 */
export function StemLanes({
  durationMs,
  phrases,
  levels,
  hopMs = 250,
  layer,
  drumBeatsMs,
  voiceDetector,
  stale = false,
  emptyMessage,
}: StemLanesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(Math.round(node.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const x1 = Math.max(X0 + 100, width - VALUE_GUTTER);
  const plot = x1 - X0;
  const lastEnd = phrases[phrases.length - 1]?.endMs ?? 0;
  const span = Math.max(durationMs, lastEnd, 1);
  const x = (ms: number) =>
    round(X0 + (Math.min(Math.max(ms, 0), span) / span) * plot);
  const laneTop = (index: number) => TOP + index * (LANE_HEIGHT + LANE_GAP);
  const lanesBottom = laneTop(3) + LANE_HEIGHT;
  const voiceY = lanesBottom + 10;
  const beatsY = voiceY + 14;
  const axisY = beatsY + 18;
  const height = axisY + 16;
  const boundaries = phrases.length
    ? [...phrases.map((phrase) => phrase.startMs), lastEnd]
    : [];
  const minutes = Array.from(
    { length: Math.floor(span / 60_000) + 1 },
    (_, minute) => minute * 60_000,
  ).filter((ms) => x(span) - x(ms) > 44);
  const quiet = (stem: StemName) => stem === "other";
  const drawn = width > 0;

  return (
    <div
      ref={ref}
      className="stem-lanes"
      data-slot="stem-lanes"
      data-stale={stale ? "true" : "false"}
    >
      {drawn && phrases.length ? (
        <PhraseStrip phrases={phrases} x={x} lastEnd={lastEnd} plot={plot} />
      ) : null}
      {drawn ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label="Stem levels over time"
        >
          <defs>
            <linearGradient id="stem-ridge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="stem-lanes-ridge-from" />
              <stop offset="1" className="stem-lanes-ridge-to" />
            </linearGradient>
            <linearGradient id="stem-quiet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="stem-lanes-quiet-from" />
              <stop offset="1" className="stem-lanes-quiet-to" />
            </linearGradient>
            <filter
              id="stem-glow"
              x="-20%"
              y="-400%"
              width="140%"
              height="900%"
            >
              <feGaussianBlur
                in="SourceAlpha"
                stdDeviation="2.6"
                result="blur"
              />
              <feFlood className="stem-lanes-glow-flood" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {boundaries.map((ms, index) => (
            <line
              key={`b${index}`}
              className="stem-lanes-boundary"
              data-slot="phrase-boundary"
              x1={x(ms)}
              x2={x(ms)}
              y1={0}
              y2={beatsY + 10}
            />
          ))}

          {STEMS.map((stem, index) => {
            const top = laneTop(index);
            const bottom = top + LANE_HEIGHT;
            const y = (byte: number) =>
              round(bottom - (byte / 255) * LANE_HEIGHT);
            const values = levels?.[stem] ?? null;
            const columns = values ? envelope(values, hopMs, span, plot) : null;
            const average = values ? mean(values) : null;
            const points = columns
              ?.map((value, column) => `${X0 + column + 0.5},${y(value)}`)
              .join(" ");
            return (
              <g
                key={stem}
                className="stem-lanes-lane"
                data-stem={stem}
                data-quiet={quiet(stem) ? "true" : "false"}
              >
                <text
                  className="stem-lanes-label"
                  x={0}
                  y={top + LANE_HEIGHT / 2 + 2}
                >
                  {STEM_LABELS[stem]}
                </text>
                <text
                  className="stem-lanes-sublabel"
                  x={0}
                  y={top + LANE_HEIGHT / 2 + 17}
                >
                  {quiet(stem) ? "not stored" : ""}
                </text>
                <line
                  className="stem-lanes-baseline"
                  x1={X0}
                  x2={x1}
                  y1={bottom}
                  y2={bottom}
                />
                {[85, 170].map((byte) => (
                  <line
                    key={byte}
                    className="stem-lanes-grid"
                    x1={X0}
                    x2={x1}
                    y1={y(byte)}
                    y2={y(byte)}
                  />
                ))}
                {points ? (
                  <>
                    <polygon
                      data-slot="stem-ridge"
                      points={`${X0},${bottom} ${points} ${x1},${bottom}`}
                      fill={
                        quiet(stem) || stale
                          ? "url(#stem-quiet)"
                          : "url(#stem-ridge)"
                      }
                    />
                    <polyline
                      className="stem-lanes-ridge-line"
                      points={points}
                    />
                  </>
                ) : null}
                {layer && !stale
                  ? layer.map((phrase, phraseIndex) => (
                      <rect
                        key={phraseIndex}
                        className="stem-lanes-plateau"
                        data-slot="stem-plateau"
                        x={x(phrase.startMs) + 1.5}
                        y={y(phrase[stem]) - 1}
                        width={Math.max(
                          1,
                          x(phrase.endMs) - x(phrase.startMs) - 3,
                        )}
                        height={2}
                        rx={1}
                        filter={quiet(stem) ? undefined : "url(#stem-glow)"}
                      />
                    ))
                  : null}
                {average != null ? (
                  <text
                    className="stem-lanes-value"
                    x={width}
                    y={top + LANE_HEIGHT / 2 + 7}
                    textAnchor="end"
                  >
                    {dbText(average)}
                    <tspan className="stem-lanes-unit"> dB</tspan>
                  </text>
                ) : null}
              </g>
            );
          })}

          {!levels && emptyMessage ? (
            <>
              <rect
                className="stem-lanes-empty-band"
                x={X0}
                y={laneTop(0)}
                width={plot}
                height={lanesBottom - laneTop(0)}
              />
              <text
                className="stem-lanes-empty"
                x={(X0 + x1) / 2}
                y={(laneTop(0) + lanesBottom) / 2 + 4}
                textAnchor="middle"
              >
                {emptyMessage}
              </text>
            </>
          ) : null}

          {voiceDetector && phrases.length ? (
            <g data-slot="voice-row">
              <text className="stem-lanes-sublabel" x={0} y={voiceY + 3}>
                {voiceDetector.startsWith("yamnet") ? "YAMNet voice" : "Voice"}
              </text>
              {phrases.map((phrase, index) => (
                <rect
                  key={index}
                  className="stem-lanes-voice"
                  x={x(phrase.startMs) + 1}
                  y={voiceY}
                  width={Math.max(1, x(phrase.endMs) - x(phrase.startMs) - 2)}
                  height={2}
                  opacity={phrase.voiced == null ? 0 : phrase.voiced ? 1 : 0.15}
                />
              ))}
            </g>
          ) : null}

          {drumBeatsMs?.length ? (
            <g data-slot="drum-beats">
              <text className="stem-lanes-sublabel" x={0} y={beatsY + 8}>
                Drum beats
              </text>
              {drumBeatsMs.map((ms, index) => (
                <line
                  key={index}
                  className="stem-lanes-beat"
                  x1={x(ms)}
                  x2={x(ms)}
                  y1={beatsY}
                  y2={beatsY + 9}
                />
              ))}
            </g>
          ) : null}

          <line
            className="stem-lanes-baseline"
            x1={X0}
            x2={x1}
            y1={axisY - 8}
            y2={axisY - 8}
          />
          {minutes.map((ms) => (
            <g key={ms}>
              <line
                className="stem-lanes-tick"
                x1={x(ms)}
                x2={x(ms)}
                y1={axisY - 8}
                y2={axisY - 4}
              />
              <text
                className="stem-lanes-axis"
                x={x(ms)}
                y={axisY + 6}
                textAnchor={ms === 0 ? "start" : "middle"}
              >
                {clock(ms, false)}
              </text>
            </g>
          ))}
          <line
            className="stem-lanes-tick"
            x1={x1}
            x2={x1}
            y1={axisY - 8}
            y2={axisY - 4}
          />
          <text
            className="stem-lanes-axis"
            x={x1}
            y={axisY + 6}
            textAnchor="end"
          >
            {clock(span)}
          </text>
        </svg>
      ) : null}
    </div>
  );
}
