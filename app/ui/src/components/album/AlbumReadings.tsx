import type { CSSProperties } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import "./album-readings.css";

export interface ReadingSeries {
  label: string;
  unit: string;
  /** Decimals shown for the mean and the extremes. */
  digits: number;
  /** The library's usual range; values outside it sit on its edges. */
  domain: readonly [number, number];
  /** One value per measured track, with the track's name when it is known. */
  values: { label?: string; value: number }[];
}

export interface KeyCount {
  key: string;
  count: number;
}

// The strip spans 96% of the reading's width, from 2% to 98%, at a fixed height: marks
// keep the weight of the approved mockup at any column width.
const START = 2;
const SPAN = 96;
const HEIGHT = 28;
const MIDDLE = HEIGHT / 2;
const MAX_KEYS = 6;

function percent(value: number) {
  return `${Number(value.toFixed(1))}%`;
}

function place([low, high]: ReadingSeries["domain"], value: number) {
  const share = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return START + SPAN * share;
}

function format(reading: ReadingSeries, value: number) {
  return `${value.toFixed(reading.digits)} ${reading.unit}`;
}

function describe(reading: ReadingSeries, mean: number) {
  const { label, values } = reading;
  if (values.length < 2) return `${label}: ${format(reading, mean)}`;
  const low = values.reduce((min, entry) =>
    entry.value < min.value ? entry : min,
  );
  const high = values.reduce((max, entry) =>
    entry.value > max.value ? entry : max,
  );
  const named = (entry: { label?: string; value: number }) =>
    entry.label
      ? `${format(reading, entry.value)} (${entry.label})`
      : format(reading, entry.value);
  return `${label}: ${format(reading, mean)}, from ${named(low)} to ${named(high)}`;
}

function ReadingStrip({
  reading,
  mean,
}: {
  reading: ReadingSeries;
  mean: number;
}) {
  const positions = reading.values.map((entry) =>
    place(reading.domain, entry.value),
  );
  const album = positions.length > 1;
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const description = describe(reading, mean);

  return (
    <TooltipHint content={description}>
      <div
        data-slot="album-reading-strip"
        role="img"
        aria-label={description}
        tabIndex={0}
        className="album-reading-graphic"
      >
        <svg
          width="100%"
          height={HEIGHT}
          aria-hidden="true"
          className="album-reading-svg"
        >
          <line
            className="album-reading-axis"
            x1={percent(START)}
            x2={percent(START + SPAN)}
            y1={MIDDLE}
            y2={MIDDLE}
          />
          {album ? (
            <rect
              data-slot="album-reading-range"
              className="album-reading-range"
              x={percent(first)}
              width={percent(last - first)}
              y={MIDDLE - 6}
              height="12"
              rx="6"
            />
          ) : null}
          {album
            ? positions.map((position, track) => (
                <line
                  key={track}
                  data-slot="album-reading-tick"
                  className="album-reading-tick"
                  x1={percent(position)}
                  x2={percent(position)}
                  y1={MIDDLE - 7}
                  y2={MIDDLE + 7}
                />
              ))
            : null}
          <rect
            data-slot="album-reading-mean"
            className="album-reading-mean"
            x={percent(place(reading.domain, mean))}
            y={MIDDLE - 12}
            width="6"
            height="24"
            rx="3"
            transform="translate(-3 0)"
          />
        </svg>
      </div>
    </TooltipHint>
  );
}

function Reading({
  reading,
  index,
}: {
  reading: ReadingSeries;
  index: number;
}) {
  const mean = reading.values.length
    ? reading.values.reduce((sum, entry) => sum + entry.value, 0) /
      reading.values.length
    : null;

  return (
    <div
      data-slot="album-reading"
      className="album-reading"
      style={{ "--row": index } as CSSProperties}
    >
      <MonoLabel as="dt">{reading.label}</MonoLabel>
      <dd className="album-reading-value">
        {mean == null ? "—" : format(reading, mean)}
      </dd>
      {mean == null ? null : (
        <dd className="album-reading-detail">
          <ReadingStrip reading={reading} mean={mean} />
        </dd>
      )}
    </div>
  );
}

/**
 * The album's tempo, loudness and dynamic range as means over strips on the library's
 * usual scale, a mark per track and the mean glowing among them (the sound spectrum's
 * language), and its keys counted with the most frequent first.
 */
export function AlbumReadings({
  readings,
  keys,
  keyLabel = "Most frequent key",
  animate,
}: {
  readings: ReadingSeries[];
  keys: KeyCount[];
  keyLabel?: string;
  animate: boolean;
}) {
  const ranked = [...keys].sort((a, b) => b.count - a.count);
  // One key on one track is already the value; the list only counts several.
  const counted = ranked.length > 1 || (ranked[0]?.count ?? 0) > 1;
  const shown = counted ? ranked.slice(0, MAX_KEYS) : [];
  const folded = ranked.length - shown.length;

  return (
    <dl
      data-slot="album-readings"
      data-animated={animate ? "true" : "false"}
      className="album-readings"
    >
      {readings.map((reading, index) => (
        <Reading key={reading.label} reading={reading} index={index} />
      ))}
      <div
        data-slot="album-reading"
        className="album-reading"
        style={{ "--row": readings.length } as CSSProperties}
      >
        <MonoLabel as="dt">{keyLabel}</MonoLabel>
        <dd className="album-reading-value">{ranked[0]?.key ?? "—"}</dd>
        {shown.length ? (
          <dd className="album-reading-detail">
            <ul aria-label="Keys" className="album-reading-keys">
              {shown.map((entry, index) => (
                <li
                  key={entry.key}
                  className="album-reading-key"
                  data-dominant={index === 0 ? "true" : undefined}
                >
                  {entry.key} ×{entry.count}
                </li>
              ))}
              {folded ? (
                <li className="album-reading-key">+{folded} more</li>
              ) : null}
            </ul>
          </dd>
        ) : null}
      </div>
    </dl>
  );
}
