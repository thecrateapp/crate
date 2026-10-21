import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { formatStatsMinutes } from "@/components/stats/stats-format";
import type {
  StatsTape,
  StatsTapePeak,
  StatsTapePoint,
} from "@/components/stats/stats-types";
import { isMotionBlocked } from "@/lib/motion-availability";

import {
  bucketOfDay,
  dragPartAt,
  explorerAxisLabels,
  explorerMonthLabels,
  formatExplorerDay,
  formatExplorerMonth,
  formatExplorerRange,
  formatExplorerWeekday,
  minuteTicks,
  resizeStep,
  resizeWindow,
} from "./stats-explorer-chart";
import {
  bucketRange,
  clampWindow,
  stretchRange,
  type ExplorerMode,
  type ExplorerWindow,
} from "./stats-explorer-model";

/** The window opens once from today backwards (stats recipe keyframes). */
const OPENING_MS = 1100;
const OPENING_GRACE_MS = 100;
const BAR_STAGGER_MS = 500;
const SHIFT_STEP = 7;
/** Share of the plot height for the tallest bar; leaves room for dots. */
const BAR_LEVEL = 92;
const MINI_LEVEL = 88;
const MIN_BAR_LEVEL = 0.9;
/** Percentage points of plot height kept clear around the average label. */
const AVERAGE_LABEL_CLEARANCE = 7;
const READOUT_FLIP = 0.66;

export interface StatsExplorerViewProps {
  tape: StatsTape;
  mode: ExplorerMode;
  /** Clamped window into `tape.points`; the whole tape in full mode. */
  window: ExplorerWindow;
  /** Bucket under the pointer or keyboard cursor in the detail chart. */
  cursor: number | null;
  /** Bucket whose detail is open in the panel. */
  selected?: number | null;
  /** Discovery days known for the stretch, besides the tape's discovery peak. */
  discoveryDays?: readonly string[];
  /** "In this stretch" panel, placed beside the chart or below it. */
  panel?: ReactNode;
  chartRef?: Ref<HTMLDivElement>;
  onWindowChange: (window: ExplorerWindow) => void;
  onCursorChange: (index: number | null) => void;
  onOpenBucket: (index: number) => void;
  onMonth: (month: string) => void;
}

export function StatsExplorerView({
  tape,
  mode,
  window: range,
  cursor,
  selected = null,
  discoveryDays,
  panel,
  chartRef,
  onWindowChange,
  onCursorChange,
  onOpenBucket,
  onMonth,
}: StatsExplorerViewProps) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(() => !isMotionBlocked());
  const windowed = mode.kind === "window";

  useEffect(() => {
    if (!opening) return;
    // Nothing moves at rest: the opening keyframes only apply while this is set.
    const timer = setTimeout(
      () => setOpening(false),
      OPENING_MS + OPENING_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="stats-explorer"
      data-mode={mode.kind}
      data-opening={opening || undefined}
    >
      <p className="mb-4 text-sm text-text-secondary">
        {t(windowed ? "stats.explorer.hint" : "stats.explorer.openDay")}
      </p>
      <div className="stats-explorer-layout">
        <div className="stats-explorer-main">
          {windowed ? (
            <>
              <ExplorerOverview
                tape={tape}
                mode={mode}
                range={range}
                onWindowChange={onWindowChange}
              />
              <ExplorerMonths tape={tape} onMonth={onMonth} />
            </>
          ) : null}
          <ExplorerChart
            tape={tape}
            range={range}
            cursor={cursor}
            selected={selected}
            discoveryDays={discoveryDays}
            opening={opening}
            chartRef={chartRef}
            onCursorChange={onCursorChange}
            onOpenBucket={onOpenBucket}
          />
        </div>
        {panel}
      </div>
    </div>
  );
}

type Drag = { kind: "move"; offset: number } | { kind: "start" | "end" };

function ExplorerOverview({
  tape,
  mode,
  range,
  onWindowChange,
}: {
  tape: StatsTape;
  mode: ExplorerMode;
  range: ExplorerWindow;
  onWindowChange: (window: ExplorerWindow) => void;
}) {
  const { t, i18n } = useTranslation();
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const count = tape.points.length;
  const span = range.to - range.from;
  const minSpan = mode.kind === "window" ? Math.min(mode.minSpan, count) : span;
  const maxSpan = mode.kind === "window" ? Math.min(mode.maxSpan, count) : span;
  const left = (range.from / count) * 100;
  const right = (range.to / count) * 100;
  // The opening starts from the narrowest window ending today.
  const openStart = ((count - Math.min(span, minSpan)) / count) * 100;
  const valueText = t(
    "stats.explorer.windowValue",
    formatExplorerRange(stretchRange(tape, range), i18n.language),
  );

  function commit(next: ExplorerWindow) {
    if (next.from !== range.from || next.to !== range.to) onWindowChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? SHIFT_STEP : 1;
    const resize = resizeStep(mode);
    let next: ExplorerWindow;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = { from: range.from - step, to: range.to - step };
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = { from: range.from + step, to: range.to + step };
        break;
      case "Home":
        next = { from: 0, to: span };
        break;
      case "End":
        next = { from: count - span, to: count };
        break;
      case "+":
      case "=": {
        const cut = span - Math.max(minSpan, span - 2 * resize);
        next = {
          from: range.from + Math.floor(cut / 2),
          to: range.to - Math.ceil(cut / 2),
        };
        break;
      }
      case "-":
      case "_":
      case "−": {
        const add = Math.min(maxSpan, span + 2 * resize) - span;
        next = {
          from: range.from - Math.floor(add / 2),
          to: range.to + Math.ceil(add / 2),
        };
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    commit(clampWindow(next, count, mode));
  }

  function indexAt(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return range.from;
    return ((event.clientX - rect.left) / rect.width) * count;
  }

  function moveTo(from: number): ExplorerWindow {
    const start = Math.round(from);
    return clampWindow({ from: start, to: start + span }, count, mode);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    // Decide by press position, not by the hit element: touch hit areas
    // reach outward only, so narrow windows stay movable from their middle.
    const part = dragPartAt(
      event.clientX - rect.left,
      (range.from / count) * rect.width,
      (range.to / count) * rect.width,
      event.pointerType === "touch" || event.pointerType === "pen",
    );
    const index = indexAt(event);
    if (part === "start" || part === "end") {
      dragRef.current = { kind: part };
    } else if (part === "window") {
      dragRef.current = { kind: "move", offset: index - range.from };
    } else {
      // Outside the window: centre it on the pointer and keep dragging.
      const next = moveTo(index - span / 2);
      commit(next);
      dragRef.current = { kind: "move", offset: index - next.from };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const index = indexAt(event);
    commit(
      drag.kind === "move"
        ? moveTo(index - drag.offset)
        : resizeWindow(range, drag.kind, index, count, mode),
    );
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  return (
    <div
      className="stats-explorer-overview"
      role="slider"
      tabIndex={0}
      aria-label={t("stats.explorer.window")}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - span)}
      aria-valuenow={range.from}
      aria-valuetext={valueText}
      data-dragging={dragging || undefined}
      style={{ "--stats-explorer-open": `${openStart}%` } as CSSProperties}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={(event) => {
        // Touch implicitly captures the pressed child (frame or handle); it
        // reports losing that capture when the strip takes it. Only the strip
        // losing capture ends the drag.
        if (event.target === event.currentTarget) endDrag(event);
      }}
    >
      <OverviewBars points={tape.points} />
      <span
        className="stats-explorer-shade"
        data-edge="start"
        style={{ width: `${left}%` }}
      />
      <span
        className="stats-explorer-shade"
        data-edge="end"
        style={{ left: `${right}%` }}
      />
      <span
        className="stats-explorer-frame"
        data-part="window"
        style={{ left: `${left}%`, right: `${100 - right}%` }}
      />
      <span
        className="stats-explorer-handle"
        data-part="start"
        style={{ left: `${left}%` }}
      />
      <span
        className="stats-explorer-handle"
        data-part="end"
        style={{ left: `${right}%` }}
      />
    </div>
  );
}

const OverviewBars = memo(function OverviewBars({
  points,
}: {
  points: StatsTapePoint[];
}) {
  const max = Math.max(1, ...points.map((point) => point.minutes));
  return (
    <svg
      className="stats-explorer-mini"
      viewBox={`0 0 ${Math.max(1, points.length)} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {points.map((point, index) => {
        if (point.minutes <= 0) return null;
        // Square-root scale keeps quiet days visible next to marathons.
        const height = Math.sqrt(point.minutes / max) * MINI_LEVEL;
        return (
          <rect
            key={point.bucket}
            x={index + 0.14}
            y={100 - height}
            width={0.72}
            height={height}
          />
        );
      })}
    </svg>
  );
});

function ExplorerMonths({
  tape,
  onMonth,
}: {
  tape: StatsTape;
  onMonth: (month: string) => void;
}) {
  const { i18n } = useTranslation();
  const labels = useMemo(() => explorerMonthLabels(tape), [tape]);
  if (!labels.length) return null;

  function handleClick(event: MouseEvent<HTMLAnchorElement>, month: string) {
    // Modified clicks keep the native link behaviour (new tab, window).
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onMonth(month);
  }

  return (
    <div className="stats-explorer-months">
      {labels.map((label) => (
        <a
          key={label.month}
          href={`?month=${label.month}`}
          className="stats-explorer-month"
          data-minor={label.minor || undefined}
          style={{ left: `${label.position * 100}%` }}
          aria-label={formatExplorerMonth(label.month, i18n.language, "long")}
          onClick={(event) => handleClick(event, label.month)}
        >
          <MonoLabel as="span">
            {label.showYear
              ? label.month.slice(0, 4)
              : formatExplorerMonth(label.month, i18n.language, "short")}
          </MonoLabel>
        </a>
      ))}
    </div>
  );
}

function ExplorerChart({
  tape,
  range,
  cursor,
  selected,
  discoveryDays,
  opening,
  chartRef,
  onCursorChange,
  onOpenBucket,
}: {
  tape: StatsTape;
  range: ExplorerWindow;
  cursor: number | null;
  selected: number | null;
  discoveryDays?: readonly string[];
  opening: boolean;
  chartRef?: Ref<HTMLDivElement>;
  onCursorChange: (index: number | null) => void;
  onOpenBucket: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const count = Math.max(0, range.to - range.from);
  const slice = tape.points.slice(range.from, range.to);
  const max = Math.max(1, ...slice.map((point) => point.minutes));
  const level = (minutes: number) => (minutes / max) * BAR_LEVEL;
  const average = count
    ? slice.reduce((sum, point) => sum + point.minutes, 0) / count
    : 0;
  const ticks = minuteTicks(max);
  const barWidth = count <= 10 ? 0.44 : 0.68;
  const active =
    cursor != null && cursor >= range.from && cursor < range.to ? cursor : null;

  const peaks = useMemo(() => {
    const byBucket = new Map<string, StatsTapePeak[]>();
    for (const peak of tape.peaks) {
      byBucket.set(peak.bucket, [...(byBucket.get(peak.bucket) ?? []), peak]);
    }
    return byBucket;
  }, [tape.peaks]);
  const discoveries = useMemo(
    () =>
      new Set([
        ...tape.peaks
          .filter((peak) => peak.kind === "discovery")
          .map((peak) => peak.bucket),
        ...(discoveryDays ?? []).map((day) => bucketOfDay(tape, day)),
      ]),
    [tape, discoveryDays],
  );

  function indexAt(event: MouseEvent<HTMLDivElement>): number | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || !count) return null;
    const offset = Math.floor(
      ((event.clientX - rect.left) / rect.width) * count,
    );
    return range.from + Math.min(count - 1, Math.max(0, offset));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!count) return;
    const last = range.to - 1;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = active == null ? last : Math.max(range.from, active - 1);
        break;
      case "ArrowRight":
        next = active == null ? range.from : Math.min(last, active + 1);
        break;
      case "Home":
        next = range.from;
        break;
      case "End":
        next = last;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onOpenBucket(active ?? last);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next !== cursor) onCursorChange(next);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    if (cursor != null) onCursorChange(null);
  }

  const averageLevel = level(average);
  const position = (offset: number) => ((offset + 0.5) / count) * 100;
  const scaleLabels = [
    ...ticks
      // Tick labels this close to the average line give way to its label.
      .filter(
        (value) =>
          average <= 0 ||
          Math.abs(level(value) - averageLevel) >= AVERAGE_LABEL_CLEARANCE,
      )
      .map((value) => ({
        key: `tick:${value}`,
        text: formatStatsMinutes(value),
        level: level(value),
        average: false,
      })),
    ...(average > 0
      ? [
          {
            key: "average",
            text: t("stats.explorer.averageLine"),
            level: averageLevel,
            average: true,
          },
        ]
      : []),
  ];

  return (
    <div
      ref={chartRef}
      className="stats-explorer-chart"
      role="group"
      tabIndex={0}
      aria-label={t("stats.explorer.chart")}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      <div
        className="stats-explorer-plot"
        onPointerMove={(event) => {
          const index = indexAt(event);
          if (index !== cursor) onCursorChange(index);
        }}
        onPointerLeave={() => {
          if (cursor != null) onCursorChange(null);
        }}
        onClick={(event) => {
          const index = indexAt(event);
          if (index != null) onOpenBucket(index);
        }}
      >
        {ticks.map((value) => (
          <i
            key={value}
            className="stats-explorer-grid"
            style={{ bottom: `${level(value)}%` }}
          />
        ))}
        {active != null ? (
          <i
            className="stats-explorer-cursor"
            style={{
              left: `${((active - range.from) / count) * 100}%`,
              width: `${100 / count}%`,
            }}
          />
        ) : null}
        <svg
          className="stats-explorer-bars"
          viewBox={`0 0 ${Math.max(1, count)} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {slice.map((point, offset) => {
            if (point.minutes <= 0) return null;
            const index = range.from + offset;
            const height = Math.max(MIN_BAR_LEVEL, level(point.minutes));
            return (
              <rect
                key={point.bucket}
                className="stats-explorer-bar"
                x={offset + (1 - barWidth) / 2}
                y={100 - height}
                width={barWidth}
                height={height}
                data-hot={peaks.has(point.bucket) || undefined}
                data-selected={index === selected || undefined}
                data-cursor={index === active || undefined}
                style={
                  opening
                    ? {
                        // Opens from today backwards: the newest bar first.
                        animationDelay: `${Math.round(
                          ((count - 1 - offset) / count) * BAR_STAGGER_MS,
                        )}ms`,
                      }
                    : undefined
                }
              />
            );
          })}
        </svg>
        {average > 0 ? (
          <i
            className="stats-explorer-average"
            style={{ bottom: `${averageLevel}%` }}
          />
        ) : null}
        {slice.map((point, offset) =>
          point.minutes > 0 && discoveries.has(point.bucket) ? (
            <i
              key={`dot:${point.bucket}`}
              className="stats-explorer-dot"
              style={{
                left: `${position(offset)}%`,
                bottom: `${level(point.minutes)}%`,
              }}
            />
          ) : null,
        )}
        {/* Not a live region: hovering must not chatter; the panel announces. */}
        <div className="stats-explorer-readout-host">
          {active != null ? (
            <ChartReadout
              tape={tape}
              index={active}
              position={(active - range.from + 0.5) / count}
              peaks={peaks.get(tape.points[active]!.bucket) ?? []}
            />
          ) : null}
        </div>
      </div>
      {/* Scale column: as wide as its longest label, so no locale overflows. */}
      <div className="stats-explorer-scale" aria-hidden="true">
        <span className="stats-explorer-tick stats-explorer-scale-sizer">
          {scaleLabels.reduce(
            (longest, label) =>
              label.text.length > longest.length ? label.text : longest,
            "",
          )}
        </span>
        {scaleLabels.map((label) => (
          <span
            key={label.key}
            className="stats-explorer-tick"
            data-average={label.average || undefined}
            style={{ bottom: `${label.level}%` }}
          >
            {label.text}
          </span>
        ))}
      </div>
      <div className="stats-explorer-axis" aria-hidden="true">
        {explorerAxisLabels(count).map(({ offset, minor }) => {
          const point = slice[offset]!;
          return (
            <MonoLabel
              key={point.bucket}
              as="span"
              data-minor={minor || undefined}
              style={{ left: `${position(offset)}%` }}
            >
              {formatExplorerDay(point.bucket, i18n.language)}
            </MonoLabel>
          );
        })}
      </div>
    </div>
  );
}

function ChartReadout({
  tape,
  index,
  position,
  peaks,
}: {
  tape: StatsTape;
  index: number;
  position: number;
  peaks: StatsTapePeak[];
}) {
  const { t, i18n } = useTranslation();
  const point = tape.points[index]!;
  const weekly = tape.granularity === "week";
  const date = weekly
    ? t(
        "stats.explorer.windowValue",
        formatExplorerRange(bucketRange(tape, index), i18n.language),
      )
    : formatExplorerWeekday(point.bucket, i18n.language);
  const obsession = peaks.find((peak) => peak.kind === "obsession");
  const discovery = peaks.find((peak) => peak.kind === "discovery");

  return (
    <div
      className="stats-explorer-readout"
      data-side={position > READOUT_FLIP ? "left" : "right"}
      style={{ left: `${position * 100}%` }}
    >
      <MonoLabel as="span" tone="accent">
        {date}
      </MonoLabel>
      <span className="text-xs text-text-secondary">
        {formatStatsMinutes(point.minutes)}
        <span aria-hidden="true" className="px-1">
          ·
        </span>
        {t("stats.explorer.plays", { count: point.plays })}
      </span>
      {obsession?.track?.title ? (
        <span className="truncate text-xs text-text-primary">
          {obsession.track.title}
          <span aria-hidden="true" className="px-1">
            ·
          </span>
          {t("stats.explorer.plays", { count: obsession.value })}
        </span>
      ) : null}
      {discovery?.artist ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-primary">
          <i className="stats-explorer-legend-dot" aria-hidden="true" />
          <span className="sr-only">{t("stats.explorer.discoveries")}</span>
          <span className="truncate">{discovery.artist}</span>
        </span>
      ) : null}
      {weekly ? null : (
        <MonoLabel as="span">{t("stats.explorer.openDay")}</MonoLabel>
      )}
    </div>
  );
}
