import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import {
  EQ_CHART_BANDS,
  EQ_CHART_GAIN_MAX,
  EQ_CHART_GAIN_MIN,
  EQ_CHART_GAIN_PAGE_STEP,
  EQ_CHART_GAIN_RANGE,
  EQ_CHART_GAIN_STEP,
  bandX,
  clampGain,
  eqCurvePath,
  formatGain,
  gainToY,
  snapGain,
} from "@crate/ui/lib/eq-curve";

import { useEqMorph } from "./eq-morph";

export {
  EQ_CHART_BANDS,
  eqCurvePath,
  formatGain,
  gainToY,
  snapGain,
} from "../../lib/eq-curve";

const BAR_WIDTH = 3.4;
const KEY_COMMIT_DELAY_MS = 150;
const SCALE_ROWS = [
  { db: 12, label: "+12", className: "top-0" },
  { db: 6, label: "+6", className: "top-1/4" },
  { db: 0, label: "0 dB", className: "top-1/2" },
  { db: -6, label: "−6", className: "top-3/4" },
  { db: -12, label: "−12", className: "top-full" },
] as const;

export interface EqBandsProps {
  gains: readonly number[];
  onBandInput?: (bandIndex: number, gainDb: number) => void;
  onBandChange?: (bandIndex: number, gainDb: number) => void;
  disabled?: boolean;
  animate?: boolean;
  trackClassName?: string;
  bandLabel?: (bandIndex: number) => string;
  bandValueText?: (bandIndex: number, gainDb: number) => string;
}

function defaultBandLabel(bandIndex: number): string {
  return `${EQ_CHART_BANDS[bandIndex]!.label} Hz`;
}

function defaultBandValueText(bandIndex: number, gainDb: number): string {
  return `${EQ_CHART_BANDS[bandIndex]!.label} Hz, ${formatGain(gainDb)} dB`;
}

function keyDelta(key: string): number | "min" | "max" | null {
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return EQ_CHART_GAIN_STEP;
    case "ArrowDown":
    case "ArrowLeft":
      return -EQ_CHART_GAIN_STEP;
    case "PageUp":
      return EQ_CHART_GAIN_PAGE_STEP;
    case "PageDown":
      return -EQ_CHART_GAIN_PAGE_STEP;
    case "Home":
      return "min";
    case "End":
      return "max";
    default:
      return null;
  }
}

export const EqBands = memo(function EqBands({
  gains,
  onBandInput,
  onBandChange,
  disabled = false,
  animate = true,
  trackClassName = "h-24",
  bandLabel = defaultBandLabel,
  bandValueText = defaultBandValueText,
}: EqBandsProps) {
  const gradientId = useId();
  const interactive = (!!onBandChange || !!onBandInput) && !disabled;

  const glowRef = useRef<SVGPathElement>(null);
  const curveRef = useRef<SVGPathElement>(null);
  const barRefs = useRef<(SVGRectElement | null)[]>([]);
  const handleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const sliderRefs = useRef<(HTMLDivElement | null)[]>([]);
  const numeralRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const compactNumeralRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const exactNumeralRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const draggedBandRef = useRef<number | null>(null);
  const dragBoundsRef = useRef<{ top: number; height: number } | null>(null);
  const editedRef = useRef<{ band: number; gain: number } | null>(null);
  const pendingInputRef = useRef<{ band: number; gain: number } | null>(null);
  const inputFrameRef = useRef<number | null>(null);
  const keyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onBandInput, onBandChange, bandValueText });
  const gainsRef = useRef(gains);

  useLayoutEffect(() => {
    callbacksRef.current = { onBandInput, onBandChange, bandValueText };
    gainsRef.current = gains;
  });

  const draw = useCallback((values: readonly number[]) => {
    const curve = eqCurvePath(values);
    glowRef.current?.setAttribute("d", curve);
    curveRef.current?.setAttribute("d", curve);
    values.forEach((value, index) => {
      const y = gainToY(value);
      const bar = barRefs.current[index];
      if (bar) {
        bar.setAttribute("y", String(Math.min(y, 50)));
        bar.setAttribute("height", String(Math.abs(50 - y)));
      }
      const handle = handleRefs.current[index];
      if (handle) handle.style.top = `${y}%`;
    });
  }, []);

  const morph = useEqMorph({
    targets: gains,
    animate,
    draggedBandRef,
    render: draw,
  });

  const writeReadout = useCallback((band: number, gain: number) => {
    const numeral = numeralRefs.current[band];
    if (numeral) numeral.textContent = formatGain(gain);
    const compact = compactNumeralRefs.current[band];
    if (compact)
      compact.textContent = formatGain(
        Math.sign(gain) * Math.round(Math.abs(gain)),
      );
    const exact = exactNumeralRefs.current[band];
    if (exact) exact.textContent = `${formatGain(gain)} dB`;
    const slider = sliderRefs.current[band];
    if (slider) {
      slider.setAttribute("aria-valuenow", String(gain));
      slider.setAttribute(
        "aria-valuetext",
        callbacksRef.current.bandValueText(band, gain),
      );
    }
  }, []);

  const gainsKey = gains.join(",");
  useLayoutEffect(() => {
    gainsRef.current.forEach((gain, band) => {
      if (editedRef.current?.band !== band) writeReadout(band, gain);
    });
  }, [gainsKey, writeReadout]);

  const flushInput = useCallback(() => {
    if (inputFrameRef.current !== null) {
      cancelAnimationFrame(inputFrameRef.current);
      inputFrameRef.current = null;
    }
    const pending = pendingInputRef.current;
    pendingInputRef.current = null;
    if (pending) callbacksRef.current.onBandInput?.(pending.band, pending.gain);
  }, []);

  const edit = useCallback(
    (band: number, gain: number) => {
      editedRef.current = { band, gain };
      morph.setBand(band, gain);
      writeReadout(band, gain);
      if (!callbacksRef.current.onBandInput) return;
      pendingInputRef.current = { band, gain };
      if (inputFrameRef.current === null) {
        inputFrameRef.current = requestAnimationFrame(() => {
          inputFrameRef.current = null;
          flushInput();
        });
      }
    },
    [flushInput, morph, writeReadout],
  );

  const commit = useCallback(() => {
    if (keyCommitTimerRef.current !== null) {
      clearTimeout(keyCommitTimerRef.current);
      keyCommitTimerRef.current = null;
    }
    flushInput();
    const edited = editedRef.current;
    editedRef.current = null;
    draggedBandRef.current = null;
    dragBoundsRef.current = null;
    if (edited) callbacksRef.current.onBandChange?.(edited.band, edited.gain);
  }, [flushInput]);

  useEffect(() => () => commit(), [commit]);

  const gainFromPointer = (band: number, clientY: number): number | null => {
    const rect =
      dragBoundsRef.current ??
      sliderRefs.current[band]?.getBoundingClientRect();
    if (!rect || rect.height === 0) return null;
    const ratio =
      1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return snapGain(EQ_CHART_GAIN_MIN + ratio * EQ_CHART_GAIN_RANGE);
  };

  const onPointerDown = (band: number, event: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedBandRef.current = band;
    // The panel may reflow when the first edit leaves an automatic mode.
    // Keep this gesture on its original scale until release.
    const { top, height } = event.currentTarget.getBoundingClientRect();
    dragBoundsRef.current = { top, height };
    const gain = gainFromPointer(band, event.clientY);
    if (gain !== null) edit(band, gain);
  };

  const onPointerMove = (band: number, event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || draggedBandRef.current !== band) return;
    const gain = gainFromPointer(band, event.clientY);
    if (gain !== null && gain !== editedRef.current?.gain) edit(band, gain);
  };

  const onPointerEnd = (band: number) => {
    if (draggedBandRef.current !== band) return;
    commit();
  };

  const onKeyDown = (band: number, event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const delta = keyDelta(event.key);
    if (delta === null) return;
    event.preventDefault();
    const current =
      editedRef.current?.band === band
        ? editedRef.current.gain
        : (gains[band] ?? 0);
    const next =
      delta === "min"
        ? EQ_CHART_GAIN_MIN
        : delta === "max"
          ? EQ_CHART_GAIN_MAX
          : clampGain(current + delta);
    if (editedRef.current && editedRef.current.band !== band) commit();
    edit(band, next);
    if (keyCommitTimerRef.current !== null)
      clearTimeout(keyCommitTimerRef.current);
    keyCommitTimerRef.current = setTimeout(commit, KEY_COMMIT_DELAY_MS);
  };

  const onBlur = () => {
    if (editedRef.current && draggedBandRef.current === null) commit();
  };

  return (
    <div
      data-slot="eq-bands-viewport"
      className={cn(
        "@container/eq min-w-0 max-w-full",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)]">
        <ol
          aria-hidden="true"
          className={cn(
            "relative m-0 list-none p-0 font-mono text-micro text-text-subtle tabular-nums",
            trackClassName,
          )}
        >
          {SCALE_ROWS.map((row) => (
            <li
              key={row.db}
              className={cn(
                "absolute left-0 -translate-y-1/2 whitespace-nowrap",
                row.className,
              )}
            >
              {row.label}
            </li>
          ))}
        </ol>
        <div className={cn("relative", trackClassName)}>
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
              {SCALE_ROWS.filter((row) => row.db !== 0).map((row) => (
                <line
                  key={row.db}
                  x1="0"
                  x2="100"
                  y1={gainToY(row.db)}
                  y2={gainToY(row.db)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            <g className="stroke-border-quiet-subtle">
              {EQ_CHART_BANDS.slice(1).map((band, index) => (
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
              {EQ_CHART_BANDS.map((band, index) => (
                <rect
                  key={band.freq}
                  ref={(node) => {
                    barRefs.current[index] = node;
                  }}
                  x={bandX(index) - BAR_WIDTH / 2}
                  width={BAR_WIDTH}
                  fill={`url(#${gradientId})`}
                />
              ))}
            </g>
            <path
              ref={glowRef}
              fill="none"
              strokeWidth="14"
              strokeLinecap="round"
              className="stroke-accent-action opacity-15"
              vectorEffect="non-scaling-stroke"
            />
            <path
              ref={curveRef}
              fill="none"
              strokeWidth="2.25"
              strokeLinecap="round"
              className="stroke-accent-action-hi"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="absolute inset-0 grid grid-cols-10">
            {EQ_CHART_BANDS.map((band, index) => (
              <div
                key={band.freq}
                ref={(node) => {
                  sliderRefs.current[index] = node;
                }}
                role="slider"
                data-band={index}
                tabIndex={interactive ? 0 : -1}
                aria-orientation="vertical"
                aria-label={bandLabel(index)}
                aria-valuemin={EQ_CHART_GAIN_MIN}
                aria-valuemax={EQ_CHART_GAIN_MAX}
                aria-disabled={interactive ? undefined : true}
                className={cn(
                  "group/eq-band relative h-full rounded-sm",
                  interactive && "touch-none cursor-ns-resize",
                )}
                onTouchStart={(event) => {
                  if (interactive) event.stopPropagation();
                }}
                onTouchMove={(event) => {
                  if (interactive) event.stopPropagation();
                }}
                onTouchEnd={(event) => {
                  if (interactive) event.stopPropagation();
                }}
                onPointerDown={(event) => onPointerDown(index, event)}
                onPointerMove={(event) => onPointerMove(index, event)}
                onPointerUp={() => onPointerEnd(index)}
                onPointerCancel={() => onPointerEnd(index)}
                onLostPointerCapture={() => onPointerEnd(index)}
                onKeyDown={(event) => onKeyDown(index, event)}
                onBlur={onBlur}
              >
                <span
                  aria-hidden="true"
                  data-slot="eq-band-exact-value"
                  ref={(node) => {
                    exactNumeralRefs.current[index] = node;
                  }}
                  className={cn(
                    "pointer-events-none absolute bottom-full mb-2 hidden whitespace-nowrap rounded-sm border border-border-quiet bg-surface-overlay px-1.5 py-1 font-mono text-xs font-normal text-text-primary tabular-nums group-focus/eq-band:block group-hover/eq-band:block",
                    index === 0
                      ? "left-0"
                      : index === 9
                        ? "right-0"
                        : "left-1/2 -translate-x-1/2",
                  )}
                />
                <span
                  ref={(node) => {
                    handleRefs.current[index] = node;
                  }}
                  data-eq-handle={index}
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-accent-action-hi bg-surface-canvas"
                />
              </div>
            ))}
          </div>
        </div>
        <ol
          aria-hidden="true"
          className="col-start-2 m-0 mt-3 grid list-none grid-cols-10 p-0"
        >
          {EQ_CHART_BANDS.map((band, index) => (
            <li key={band.freq} className="flex justify-center">
              <span className="flex min-w-0 flex-col items-center gap-1 text-center">
                <span
                  ref={(node) => {
                    numeralRefs.current[index] = node;
                  }}
                  data-slot="eq-band-value"
                  className="hidden font-mono text-xs font-normal text-text-primary tabular-nums @min-[30rem]/eq:inline"
                />
                <span
                  ref={(node) => {
                    compactNumeralRefs.current[index] = node;
                  }}
                  data-slot="eq-band-compact-value"
                  className="font-mono text-xs font-normal text-text-primary tabular-nums @min-[30rem]/eq:hidden"
                />
                <MonoLabel as="span">{band.label}</MonoLabel>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
