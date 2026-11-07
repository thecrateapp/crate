import { useId, type CSSProperties } from "react";

import "./mood-rose.css";

export interface MoodSeries {
  mood: string;
  /** One score per track, 0 to 1, with the track's name when it is known. */
  values: { label?: string; value: number }[];
}

// Every mood keeps its place so two albums' roses compare at a glance: the lively moods
// at the top, the calm ones on the right, the heavy ones at the bottom and left.
const ORDER = [
  "party",
  "happy",
  "relaxed",
  "acoustic",
  "sad",
  "dark",
  "aggressive",
  "electronic",
];
// Geometry of the approved mockup (option A): a 320-unit box around a 100-unit rose.
const CENTRE = 150;
const RADIUS = 100;
const LABEL_RADIUS = RADIUS + 24;
const GAP_DEGREES = 3;
const RINGS = [0.25, 0.5, 0.75, 1];
const STRONG = 0.3;

function round(value: number) {
  return Number(value.toFixed(1));
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function xy(radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [
    round(CENTRE + radius * Math.cos(radians)),
    round(CENTRE + radius * Math.sin(radians)),
  ];
}

function point(radius: number, degrees: number) {
  return xy(radius, degrees).join(",");
}

function capitalised(mood: string) {
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

function describe(series: MoodSeries, mean: number) {
  const name = capitalised(series.mood);
  if (series.values.length < 2) return `${name}: ${percent(mean)}`;
  const low = series.values.reduce((min, entry) =>
    entry.value < min.value ? entry : min,
  );
  const high = series.values.reduce((max, entry) =>
    entry.value > max.value ? entry : max,
  );
  const named = (entry: { label?: string; value: number }) =>
    entry.label
      ? `${percent(entry.value)} (${entry.label})`
      : percent(entry.value);
  return `${name}: mean ${percent(mean)}, from ${named(low)} to ${named(high)}`;
}

/**
 * The album's moods as a rose: a petal per mood in a fixed place, as long as the album's
 * mean on a 0–100% radius with a glowing edge, and a mark per track on its spoke. Petals
 * open from the centre when motion is allowed.
 */
export function MoodRose({
  moods,
  animate,
}: {
  moods: MoodSeries[];
  animate: boolean;
}) {
  const id = `mood-rose-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const extra = moods
    .map((series) => series.mood)
    .filter((mood) => !ORDER.includes(mood))
    .sort();
  const slots = [...ORDER, ...extra];
  const step = 360 / slots.length;
  const angle = (slot: number) => -90 + step * slot;
  const drawn = slots.flatMap((mood, slot) => {
    const series = moods.find((entry) => entry.mood === mood);
    if (!series?.values.length) return [];
    const mean =
      series.values.reduce((sum, entry) => sum + entry.value, 0) /
      series.values.length;
    return [{ series, slot, mean }];
  });
  const summary = [...drawn]
    .sort(
      (a, b) =>
        Math.round(b.mean * 100) - Math.round(a.mean * 100) || a.slot - b.slot,
    )
    .map(({ series, mean }) => `${series.mood} ${percent(mean)}`)
    .join(", ");

  return (
    <div
      data-slot="mood-rose"
      data-animated={animate ? "true" : "false"}
      className="mood-rose"
    >
      <div
        role="img"
        aria-label={`Mood: ${summary}`}
        className="mood-rose-graphic"
      >
        <svg viewBox="-10 -10 320 320" aria-hidden="true">
          <defs>
            <radialGradient
              id={`${id}-petal`}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" className="mood-rose-petal-from" />
              <stop offset="1" className="mood-rose-petal-to" />
            </radialGradient>
          </defs>
          {RINGS.map((ring) => (
            <circle
              key={ring}
              className="mood-rose-grid"
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS * ring}
            />
          ))}
          {slots.map((mood, slot) => {
            const [x, y] = xy(RADIUS, angle(slot));
            return (
              <line
                key={mood}
                className="mood-rose-grid"
                x1={CENTRE}
                y1={CENTRE}
                x2={x}
                y2={y}
              />
            );
          })}
          {drawn.map(({ series, slot, mean }, index) => {
            const reach = round(RADIUS * mean);
            const from = point(reach, angle(slot) - step / 2 + GAP_DEGREES);
            const to = point(reach, angle(slot) + step / 2 - GAP_DEGREES);
            return (
              <g
                key={series.mood}
                data-slot="mood-rose-petal"
                data-mood={series.mood}
                style={{ "--petal": index } as CSSProperties}
              >
                <title>{describe(series, mean)}</title>
                <g className="mood-rose-bloom">
                  <path
                    className="mood-rose-wedge"
                    d={`M${CENTRE},${CENTRE} L${from} A${reach},${reach} 0 0 1 ${to} Z`}
                    fill={`url(#${id}-petal)`}
                  />
                  <path
                    data-slot="mood-rose-arc"
                    className="mood-rose-arc"
                    d={`M${from} A${reach},${reach} 0 0 1 ${to}`}
                  />
                </g>
                {series.values.length > 1
                  ? series.values.map((entry, track) => {
                      const [cx, cy] = xy(
                        RADIUS * Math.min(1, Math.max(0, entry.value)),
                        angle(slot),
                      );
                      return (
                        <circle
                          key={track}
                          data-slot="mood-rose-track"
                          className="mood-rose-track"
                          cx={cx}
                          cy={cy}
                          r="2"
                        />
                      );
                    })
                  : null}
              </g>
            );
          })}
          {drawn.map(({ series, slot, mean }) => {
            const [x, y] = xy(LABEL_RADIUS, angle(slot));
            return (
              <g
                key={series.mood}
                data-slot="mood-rose-label"
                data-mood={series.mood}
                data-strong={mean >= STRONG ? "true" : "false"}
                className="mood-rose-label"
              >
                <text
                  className="mood-rose-name"
                  x={x}
                  y={round(y - 2)}
                  textAnchor="middle"
                >
                  {series.mood.toUpperCase()}
                </text>
                <text
                  className="mood-rose-value"
                  x={x}
                  y={round(y + 10)}
                  textAnchor="middle"
                >
                  {percent(mean)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
