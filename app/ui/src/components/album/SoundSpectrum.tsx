import { useId, type CSSProperties } from "react";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import "./sound-spectrum.css";

export interface SpectrumFeature {
  label: string;
  /** One value per track, 0 to 1, with the track's name when it is known. */
  values: { label?: string; value: number }[];
}

// Geometry of the approved mockup: each row is a 600 x 50 drawing scaled uniformly, so
// ridges, marks and glow keep their proportions at any width (capped in CSS).
const WIDTH = 600;
const ROW_HEIGHT = 50;
const AXIS_HEIGHT = 30;
const X0 = 150;
const X1 = 510;
const BASELINE = 26;
const RIDGE_HEIGHT = 20;
const BANDWIDTH = 0.035;
const STEPS = 120;
const GRID = [0, 0.25, 0.5, 0.75, 1];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function round(value: number) {
  return Number(value.toFixed(1));
}

function x(value: number) {
  return round(X0 + (X1 - X0) * value);
}

/** Gaussian density of the track values, scaled so its peak reaches the ridge top. */
function ridgePoints(values: number[]) {
  const heights = Array.from({ length: STEPS + 1 }, (_, step) => {
    const at = step / STEPS;
    return values.reduce(
      (sum, value) => sum + Math.exp(-0.5 * ((at - value) / BANDWIDTH) ** 2),
      0,
    );
  });
  const peak = Math.max(...heights);
  return heights
    .map(
      (height, step) =>
        `${x(step / STEPS)},${round(BASELINE - (height / peak) * RIDGE_HEIGHT)}`,
    )
    .join(" ");
}

function describe(feature: SpectrumFeature, mean: number) {
  const { label, values } = feature;
  if (values.length < 2) return `${label}: ${percent(mean)}`;
  const low = values.reduce((min, entry) =>
    entry.value < min.value ? entry : min,
  );
  const high = values.reduce((max, entry) =>
    entry.value > max.value ? entry : max,
  );
  const named = (entry: { label?: string; value: number }) =>
    entry.label
      ? `${percent(entry.value)} (${entry.label})`
      : percent(entry.value);
  return `${label}: mean ${percent(mean)}, from ${named(low)} to ${named(high)}`;
}

function SpectrumRow({
  feature,
  index,
}: {
  feature: SpectrumFeature;
  index: number;
}) {
  const id = `sound-spectrum-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const values = feature.values.map((entry) => entry.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const album = values.length > 1;
  const description = describe(feature, mean);
  const ridge = album ? ridgePoints(values) : null;

  return (
    <li
      data-slot="sound-spectrum-row"
      className="sound-spectrum-row"
      style={{ "--row": index } as CSSProperties}
    >
      <TooltipHint content={description}>
        <div
          role="img"
          aria-label={description}
          tabIndex={0}
          className="sound-spectrum-graphic"
        >
          <svg viewBox={`0 0 ${WIDTH} ${ROW_HEIGHT}`} aria-hidden="true">
            <defs>
              <filter
                id={`${id}-glow`}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id={`${id}-fill`} x1="0" x2="1">
                <stop offset="0" className="sound-spectrum-fill-from" />
                <stop offset="1" className="sound-spectrum-fill-to" />
              </linearGradient>
              <linearGradient id={`${id}-ridge`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="sound-spectrum-ridge-from" />
                <stop offset="1" className="sound-spectrum-ridge-to" />
              </linearGradient>
            </defs>
            {GRID.map((at) => (
              <line
                key={at}
                className="sound-spectrum-grid"
                x1={x(at)}
                x2={x(at)}
                y1="0"
                y2={ROW_HEIGHT}
              />
            ))}
            <text
              data-slot="sound-spectrum-label"
              className="sound-spectrum-label"
              x="20"
              y={BASELINE + 4}
            >
              {feature.label}
            </text>
            <rect
              data-slot="sound-spectrum-fill"
              className="sound-spectrum-fill"
              x={X0}
              y={BASELINE - 3}
              width={round((X1 - X0) * mean)}
              height="6"
              rx="3"
              fill={`url(#${id}-fill)`}
            />
            {ridge ? (
              <g
                data-slot="sound-spectrum-ridge"
                className="sound-spectrum-ridge"
              >
                <polygon
                  points={`${X0},${BASELINE} ${ridge} ${X1},${BASELINE}`}
                  fill={`url(#${id}-ridge)`}
                />
                <polyline
                  className="sound-spectrum-ridge-line"
                  points={ridge}
                />
              </g>
            ) : null}
            {album
              ? values.map((value, track) => (
                  <line
                    key={track}
                    data-slot="sound-spectrum-tick"
                    className="sound-spectrum-tick"
                    x1={x(value)}
                    x2={x(value)}
                    y1={BASELINE - 7}
                    y2={BASELINE + 7}
                  />
                ))
              : null}
            <rect
              data-slot="sound-spectrum-mean"
              className="sound-spectrum-mean"
              x={round(x(mean) - 2)}
              y={BASELINE - 12}
              width="4"
              height="24"
              rx="2"
              filter={`url(#${id}-glow)`}
            />
            <text
              data-slot="sound-spectrum-value"
              className="sound-spectrum-value"
              x="570"
              y={BASELINE + 6}
              textAnchor="end"
            >
              {percent(mean)}
            </text>
          </svg>
        </div>
      </TooltipHint>
    </li>
  );
}

/**
 * Sound features as a spectrum: one row per feature with a glowing fill up to the mean
 * and, for an album, a mark per track under a density ridge that shows whether the
 * tracks agree (a tall, narrow ridge) or spread out (a low hill). Rows grow in from 0
 * when motion is allowed.
 */
export function SoundSpectrum({
  features,
  animate,
}: {
  features: SpectrumFeature[];
  animate: boolean;
}) {
  return (
    <div
      data-slot="sound-spectrum"
      data-animated={animate ? "true" : "false"}
      className="sound-spectrum"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${AXIS_HEIGHT}`}
        aria-hidden="true"
        className="sound-spectrum-axis"
      >
        {GRID.map((at) => (
          <g key={at}>
            <text
              className="sound-spectrum-axis-label"
              x={x(at)}
              y="20"
              textAnchor="middle"
            >
              {Math.round(at * 100)}
            </text>
            <line
              className="sound-spectrum-grid"
              x1={x(at)}
              x2={x(at)}
              y1="24"
              y2={AXIS_HEIGHT}
            />
          </g>
        ))}
      </svg>
      <ul aria-label="Sound features" className="sound-spectrum-rows">
        {features.map((feature, index) => (
          <SpectrumRow key={feature.label} feature={feature} index={index} />
        ))}
      </ul>
    </div>
  );
}
