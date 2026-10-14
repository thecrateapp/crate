import { memo, useCallback, useId, useRef, useState } from "react";

import { cn } from "@crate/ui/lib/cn";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

const EQ_BANDS = [
  { freq: 32, label: "32" },
  { freq: 64, label: "64" },
  { freq: 125, label: "125" },
  { freq: 250, label: "250" },
  { freq: 500, label: "500" },
  { freq: 1000, label: "1K" },
  { freq: 2000, label: "2K" },
  { freq: 4000, label: "4K" },
  { freq: 8000, label: "8K" },
  { freq: 16000, label: "16K" },
] as const;

const GAIN_MIN = -12;
const GAIN_MAX = 12;
const GAIN_RANGE = GAIN_MAX - GAIN_MIN;
const GAIN_STEP = 0.5;
const SCALE = [12, 6, 0, -6, -12] as const;
const BAR_WIDTH = 3.4;

export interface EqBandsProps {
  gains: readonly number[];
  onBandChange?: (bandIndex: number, gainDb: number) => void;
  disabled?: boolean;
  trackHeight?: number;
}

function snapGain(raw: number): number {
  return (
    Math.round(Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw)) / GAIN_STEP) *
    GAIN_STEP
  );
}

export function formatGain(g: number): string {
  const r = Math.round(g * 10) / 10;
  return r > 0 ? `+${r}` : r === 0 ? "0" : `−${Math.abs(r)}`;
}

function scaleLabel(db: number): string {
  if (db === 0) return "0 dB";
  return db > 0 ? `+${db}` : `−${Math.abs(db)}`;
}

function gainToY(gain: number): number {
  const clamped = Math.max(GAIN_MIN, Math.min(GAIN_MAX, gain));
  return ((GAIN_MAX - clamped) / GAIN_RANGE) * 100;
}

function bandX(index: number): number {
  return ((index + 0.5) / EQ_BANDS.length) * 100;
}

export function eqCurvePath(gains: readonly number[]): string {
  const points = EQ_BANDS.map((_, index) => ({
    x: bandX(index),
    y: gainToY(gains[index] ?? 0),
  }));
  const round = (value: number) => Math.round(value * 100) / 100;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M${round(point.x)} ${round(point.y)}`;
    const p0 = points[index - 2] ?? points[index - 1]!;
    const p1 = points[index - 1]!;
    const p3 = points[index + 1] ?? point;
    const c1x = p1.x + (point.x - p0.x) / 6;
    const c1y = p1.y + (point.y - p0.y) / 6;
    const c2x = point.x - (p3.x - p1.x) / 6;
    const c2y = point.y - (p3.y - p1.y) / 6;
    return `${path} C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(
      c2y,
    )} ${round(point.x)} ${round(point.y)}`;
  }, "");
}

function EqChart({ gains }: { gains: readonly number[] }) {
  const gradientId = useId();
  const curve = eqCurvePath(gains);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          x2="0"
          y1="0"
          y2="1"
          className="text-accent-action-hi"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <g className="stroke-border-quiet">
        {SCALE.filter((db) => db !== 0).map((db) => (
          <line
            key={db}
            x1="0"
            x2="100"
            y1={gainToY(db)}
            y2={gainToY(db)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g className="stroke-border-quiet-subtle">
        {EQ_BANDS.slice(1).map((band, index) => (
          <line
            key={band.freq}
            x1={(index + 1) * 10}
            x2={(index + 1) * 10}
            y1="0"
            y2="100"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <line
        x1="0"
        x2="100"
        y1="50"
        y2="50"
        strokeDasharray="2 4"
        className="stroke-text-faint"
        vectorEffect="non-scaling-stroke"
      />
      <g>
        {EQ_BANDS.map((band, index) => {
          const y = gainToY(gains[index] ?? 0);
          return (
            <rect
              key={band.freq}
              x={bandX(index) - BAR_WIDTH / 2}
              width={BAR_WIDTH}
              y={Math.min(y, 50)}
              height={Math.abs(50 - y)}
              fill={`url(#${gradientId})`}
            />
          );
        })}
      </g>
      <path
        d={curve}
        fill="none"
        strokeWidth="14"
        strokeLinecap="round"
        className="stroke-accent-action opacity-15"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={curve}
        fill="none"
        strokeWidth="2.25"
        strokeLinecap="round"
        className="stroke-accent-action-hi"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function BandHandle({
  index,
  gain,
  onBandChange,
  interactive,
  dragging,
  onDragStart,
}: {
  index: number;
  gain: number;
  onBandChange?: (i: number, dB: number) => void;
  interactive: boolean;
  dragging: boolean;
  onDragStart: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const computeGain = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio =
        1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      onBandChange?.(index, snapGain(GAIN_MIN + ratio * GAIN_RANGE));
    },
    [index, onBandChange],
  );

  return (
    <div
      ref={trackRef}
      data-band={index}
      className={cn("relative h-full", interactive && "cursor-ns-resize")}
      onPointerDown={(e) => {
        if (!interactive) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onDragStart();
        computeGain(e.clientY);
      }}
      onPointerMove={(e) => {
        if (interactive && e.buttons & 1) computeGain(e.clientY);
      }}
    >
      <span
        className={cn(
          "absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-accent-action-hi bg-surface-canvas",
          !dragging &&
            "transition-[top] duration-500 ease-snap motion-reduce:transition-none",
        )}
        style={{ top: `${gainToY(gain)}%` }}
      />
    </div>
  );
}

export const EqBands = memo(function EqBands({
  gains,
  onBandChange,
  disabled = false,
  trackHeight = 96,
}: EqBandsProps) {
  const [isDragging, setIsDragging] = useState(false);
  const interactive = !!onBandChange && !disabled;

  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_minmax(0,1fr)]",
        disabled && "pointer-events-none opacity-40",
      )}
      onPointerUp={() => setIsDragging(false)}
      onPointerLeave={() => setIsDragging(false)}
    >
      <ol
        aria-hidden="true"
        className="relative m-0 list-none p-0 font-mono text-micro text-text-subtle tabular-nums"
        style={{ height: trackHeight }}
      >
        {SCALE.map((db) => (
          <li
            key={db}
            className="absolute left-0 -translate-y-1/2 whitespace-nowrap"
            style={{ top: `${gainToY(db)}%` }}
          >
            {scaleLabel(db)}
          </li>
        ))}
      </ol>
      <div className="relative" style={{ height: trackHeight }}>
        <EqChart gains={gains} />
        <div className="absolute inset-0 grid grid-cols-10">
          {EQ_BANDS.map((band, i) => (
            <BandHandle
              key={band.freq}
              index={i}
              gain={gains[i] ?? 0}
              onBandChange={onBandChange}
              interactive={interactive}
              dragging={isDragging}
              onDragStart={() => setIsDragging(true)}
            />
          ))}
        </div>
      </div>
      <ol className="col-start-2 m-0 mt-4 grid list-none grid-cols-10 p-0">
        {EQ_BANDS.map((band, i) => (
          <li key={band.freq} className="flex justify-center">
            <StatNumber
              value={formatGain(gains[i] ?? 0)}
              label={band.label}
              size="sm"
              align="center"
            />
          </li>
        ))}
      </ol>
    </div>
  );
});
