import { useId, type CSSProperties } from "react";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import "./sound-spectrum.css";

export interface SpectrumFeature {
  label: string;
  /** One value per track, 0 to 1, with the track's name when it is known. */
  values: { label?: string; value: number }[];
}

// The graphic draws in a 100 x 24 box stretched to the row: x is the value in percent.
const BASELINE = 16;
const RIDGE_HEIGHT = 13;
const BANDWIDTH = 0.035;
const STEPS = 100;
const GRID = [25, 50, 75];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function coordinate(value: number) {
  return Number(value.toFixed(2));
}

/** Gaussian density of the track values, scaled so its peak touches the ridge top. */
function ridgePoints(values: number[]) {
  const heights = Array.from({ length: STEPS + 1 }, (_, step) => {
    const x = step / STEPS;
    return values.reduce(
      (sum, value) => sum + Math.exp(-0.5 * ((x - value) / BANDWIDTH) ** 2),
      0,
    );
  });
  const peak = Math.max(...heights);
  return heights
    .map(
      (height, step) =>
        `${step},${coordinate(BASELINE - (height / peak) * RIDGE_HEIGHT)}`,
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
  const gradient = `sound-spectrum-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
      <span data-slot="sound-spectrum-label" className="sound-spectrum-label">
        {feature.label}
      </span>
      <TooltipHint content={description}>
        <div
          role="img"
          aria-label={description}
          tabIndex={0}
          className="sound-spectrum-graphic"
        >
          <svg
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradient} x1="0" x2="1">
                <stop offset="0" className="sound-spectrum-stop-from" />
                <stop offset="1" className="sound-spectrum-stop-to" />
              </linearGradient>
            </defs>
            {GRID.map((x) => (
              <line
                key={x}
                className="sound-spectrum-grid"
                x1={x}
                x2={x}
                y1="0"
                y2="24"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              className="sound-spectrum-baseline"
              x1="0"
              x2="100"
              y1={BASELINE}
              y2={BASELINE}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              data-slot="sound-spectrum-fill"
              className="sound-spectrum-fill"
              x="0"
              y={BASELINE - 1.5}
              width={coordinate(mean * 100)}
              height="3"
              rx="1.5"
              fill={`url(#${gradient})`}
            />
            {ridge ? (
              <g
                data-slot="sound-spectrum-ridge"
                className="sound-spectrum-ridge"
              >
                <polygon
                  className="sound-spectrum-ridge-area"
                  points={`0,${BASELINE} ${ridge} 100,${BASELINE}`}
                />
                <polyline
                  className="sound-spectrum-ridge-line"
                  points={ridge}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : null}
            {album
              ? values.map((value, track) => (
                  <line
                    key={track}
                    data-slot="sound-spectrum-tick"
                    className="sound-spectrum-tick"
                    x1={coordinate(value * 100)}
                    x2={coordinate(value * 100)}
                    y1={BASELINE - 5}
                    y2={BASELINE + 5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              : null}
            <line
              data-slot="sound-spectrum-mean"
              className="sound-spectrum-mean"
              x1={coordinate(mean * 100)}
              x2={coordinate(mean * 100)}
              y1={BASELINE - 14}
              y2={BASELINE + 7}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </TooltipHint>
      <span data-slot="sound-spectrum-value" className="sound-spectrum-value">
        {percent(mean)}
      </span>
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
      <div aria-hidden="true" className="sound-spectrum-axis">
        <span />
        <span className="sound-spectrum-ticks">
          {[0, 25, 50, 75, 100].map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </span>
        <span />
      </div>
      <ul aria-label="Sound features" className="sound-spectrum-rows">
        {features.map((feature, index) => (
          <SpectrumRow key={feature.label} feature={feature} index={index} />
        ))}
      </ul>
    </div>
  );
}
