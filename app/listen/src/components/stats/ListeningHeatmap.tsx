import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Card } from "@crate/ui/shadcn/card";

import { isMotionBlocked } from "../../lib/motion-availability";
import { CountUpNumber } from "./CountUpNumber";
import {
  HEATMAP_MIN_LISTENERS,
  buildHeatmapModel,
  heatmapGridHidden,
  msUntilNextHour,
  type HeatmapModel,
  type HeatmapScope,
} from "./heatmap-model";
import { formatStatsMinutes } from "./stats-format";
import type { StatsHeatmap } from "./stats-types";

const HOURS = 24;
const LAST_ROW = 6;
const LAST_HOUR = HOURS - 1;
/** The cell with the longest wave delay; its animationend ends the entrance. */
const LAST_WAVE_CELL = LAST_ROW * HOURS + LAST_HOUR;
const WAVE_ANIMATION = "stats-heatmap-wave";
const MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

const pad = (hour: number) => String(hour).padStart(2, "0");

function weekdayNames(locale: string, weekday: "long" | "narrow") {
  const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(MONDAY + index * DAY_MS)),
  );
}

function cellIndexOf(target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const cell = target.closest<HTMLElement>("[data-cell]");
  if (!cell) return null;
  const index = Number(cell.dataset.cell);
  return Number.isInteger(index) ? index : null;
}

export interface ListeningHeatmapProps {
  heatmap: StatsHeatmap | null | undefined;
  /** The subject's IANA zone (`dashboard.timezone`). */
  timezone: string | null | undefined;
  /** Outline the current hour; only on the viewer's own /stats. */
  showNow: boolean;
  scope: HeatmapScope;
  /** First ranked genre (never the appended faller); see `heatmapTopGenre`. */
  topGenre?: string | null;
  /** First read in flight with nothing to show yet. */
  loading?: boolean;
  /** Cold snapshot: the projection is still being built. */
  pending?: boolean;
}

/**
 * Listening heatmap band (design system §4.7): 7 x 24 hours of listening as a
 * keyboard grid with a readout, the peak, the night band and, on the viewer's
 * own stats, the current hour. Pure view: no app routes, API or contexts.
 */
export function ListeningHeatmap({
  heatmap,
  timezone,
  showNow,
  scope,
  topGenre = null,
  loading = false,
  pending = false,
}: ListeningHeatmapProps) {
  if (!heatmap) {
    // Error or absent payload: the band is not mounted.
    return loading || pending ? (
      <HeatmapPlaceholder building={pending && !loading} />
    ) : null;
  }
  return (
    <HeatmapBand
      heatmap={heatmap}
      timezone={timezone ?? null}
      showNow={showNow}
      scope={scope}
      topGenre={topGenre}
    />
  );
}

function HeatmapPlaceholder({ building }: { building: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-4 p-5" aria-busy="true">
      <MonoLabel as="h3" tone="accent">
        {t("stats.heatmap.title")}
      </MonoLabel>
      <div className="stats-heatmap-band" aria-hidden="true">
        <div className="stats-heatmap">
          {Array.from({ length: 7 }, (_, weekday) => (
            <div key={weekday} className="stats-heatmap-row">
              <span />
              {Array.from({ length: HOURS }, (_, hour) => (
                <span key={hour} className="stats-heatmap-cell" />
              ))}
            </div>
          ))}
        </div>
      </div>
      {building ? (
        <MonoLabel as="p">{t("stats.heatmap.building")}</MonoLabel>
      ) : (
        <span className="sr-only">{t("common.loadingShort")}</span>
      )}
    </Card>
  );
}

function HeatmapBand({
  heatmap,
  timezone,
  showNow,
  scope,
  topGenre,
}: {
  heatmap: StatsHeatmap;
  timezone: string | null;
  showNow: boolean;
  scope: HeatmapScope;
  topGenre: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const captionId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const zone = showNow ? timezone : null;
  const hidden = heatmapGridHidden(heatmap, scope);

  // The "now" outline moves with one timer aligned to the next hour in the
  // subject's zone (DST, :30 and :45 offsets); each fire reschedules.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!zone || hidden) return;
    const delay = msUntilNextHour(zone, new Date());
    if (delay === null) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [zone, hidden, clock]);

  // History invalidations refetch identical payloads: rebuild only on content.
  const signature = useMemo(() => JSON.stringify(heatmap), [heatmap]);
  const model = useMemo(
    () => buildHeatmapModel(heatmap, { timezone: zone, now: new Date(clock) }),
    [signature, zone, clock],
  );

  const longDays = useMemo(() => weekdayNames(locale, "long"), [locale]);
  const narrowDays = useMemo(() => weekdayNames(locale, "narrow"), [locale]);
  const labels = useMemo(
    () =>
      model.rows.map((row) =>
        row.map((cell) =>
          t("stats.heatmap.cell", {
            weekday: longDays[cell.weekday],
            hour: pad(cell.hour),
            minutes: Math.round(cell.minutes),
          }),
        ),
      ),
    [model, longDays, t],
  );

  const peakIndex = model.peak
    ? model.peak.weekday * HOURS + model.peak.hour
    : null;
  const nowIndex = model.nowCell
    ? model.nowCell.weekday * HOURS + model.nowCell.hour
    : null;
  // Roving tab stop: the peak until the listener picks a cell.
  const [chosen, setChosen] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = chosen ?? peakIndex ?? 0;
  const readoutIndex = hovered ?? chosen ?? peakIndex;

  // Diagonal wave on the first real payload only; later data transitions opacity.
  const real = model.total > 0 && !hidden;
  const [entering, setEntering] = useState(() => real && !isMotionBlocked());
  const enteredRef = useRef(real);
  useEffect(() => {
    if (!real || enteredRef.current) return;
    enteredRef.current = true;
    if (!isMotionBlocked()) setEntering(true);
  }, [real]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const index = cellIndexOf(event.target);
    if (index === null) return;
    let weekday = Math.floor(index / HOURS);
    let hour = index % HOURS;
    switch (event.key) {
      case "ArrowRight":
        hour = Math.min(LAST_HOUR, hour + 1);
        break;
      case "ArrowLeft":
        hour = Math.max(0, hour - 1);
        break;
      case "ArrowDown":
        weekday = Math.min(LAST_ROW, weekday + 1);
        break;
      case "ArrowUp":
        weekday = Math.max(0, weekday - 1);
        break;
      case "Home":
        if (event.ctrlKey) weekday = 0;
        hour = 0;
        break;
      case "End":
        if (event.ctrlKey) weekday = LAST_ROW;
        hour = LAST_HOUR;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = weekday * HOURS + hour;
    setHovered(null);
    setChosen(next);
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${next}"]`)
      ?.focus();
  }, []);
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const index = cellIndexOf(event.target);
    if (index === null) return;
    setHovered(null);
    setChosen(index);
  }, []);
  const onClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const index = cellIndexOf(event.target);
    if (index !== null) setChosen(index);
  }, []);
  const onPointerOver = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const index = cellIndexOf(event.target);
    if (index !== null) setHovered(index);
  }, []);
  const onPointerLeave = useCallback(() => setHovered(null), []);
  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLDivElement>) => {
      if (
        event.animationName === WAVE_ANIMATION &&
        cellIndexOf(event.target) === LAST_WAVE_CELL
      )
        setEntering(false);
    },
    [],
  );

  const percent = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const formatPercent = useCallback(
    (value: number) => percent.format(value / 100),
    [percent],
  );

  const nowLabel =
    model.nowCell === null
      ? null
      : t("stats.heatmap.nowCell", {
          cell: labels[model.nowCell.weekday]![model.nowCell.hour]!,
        });
  const readoutCell =
    readoutIndex === null
      ? null
      : model.rows[Math.floor(readoutIndex / HOURS)]?.[readoutIndex % HOURS];
  const readout = readoutCell
    ? t("stats.heatmap.readout", {
        weekday: longDays[readoutCell.weekday],
        hour: pad(readoutCell.hour),
        minutes: formatStatsMinutes(readoutCell.minutes),
      })
    : "";
  const figure = model.peak
    ? t("stats.heatmap.figure", {
        weekday: longDays[model.peak.weekday],
        hour: `${pad(model.peak.hour)}:00`,
        share: percent.format(model.nightShare),
      })
    : t("stats.heatmap.empty");

  const counters: { key: string; label: string; value: ReactNode }[] = [];
  if (!hidden && model.peak) {
    counters.push({
      key: "peak",
      label: t("stats.heatmap.peak"),
      value: `${longDays[model.peak.weekday]} ${pad(model.peak.hour)}:00`,
    });
  }
  if (!hidden && model.total > 0 && model.nightRange) {
    counters.push({
      key: "night",
      label: t("stats.heatmap.night", {
        start: pad(model.nightRange.start),
        end: pad(model.nightRange.end),
      }),
      value: (
        <CountUpNumber
          value={Math.round(model.nightShare * 100)}
          format={formatPercent}
        />
      ),
    });
  }
  if (topGenre) {
    counters.push({
      key: "genre",
      label: t("stats.heatmap.topGenre"),
      value: topGenre,
    });
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <MonoLabel as="h3" tone="accent">
            {t("stats.heatmap.title")}
          </MonoLabel>
          {scope === "global" && !hidden ? (
            <MonoLabel as="span">{t("stats.heatmap.localTime")}</MonoLabel>
          ) : null}
        </div>
        {!hidden ? (
          <p
            data-slot="heatmap-readout"
            className="crate-readout m-0 font-mono font-normal text-eyebrow tracking-wide text-text-muted"
          >
            {readout}
          </p>
        ) : null}
      </div>
      {hidden ? (
        <p className="m-0 text-sm text-text-secondary">
          {t("stats.heatmap.fewListeners", { count: HEATMAP_MIN_LISTENERS })}
        </p>
      ) : (
        <figure className="stats-heatmap-band">
          <HeatmapGrid
            gridRef={gridRef}
            model={model}
            labels={labels}
            nowLabel={nowLabel}
            weekdays={narrowDays}
            active={active}
            nowIndex={nowIndex}
            entering={entering}
            gridLabel={t("stats.heatmap.grid")}
            captionId={captionId}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onClick={onClick}
            onPointerOver={onPointerOver}
            onPointerLeave={onPointerLeave}
            onAnimationEnd={onAnimationEnd}
          />
          <div
            data-slot="heatmap-hours"
            className="stats-heatmap-hours font-mono"
            aria-hidden="true"
          >
            <span />
            {model.rows[0]!.map((cell) => (
              <span key={cell.hour} data-night={cell.night ? "" : undefined}>
                {cell.hour % 6 === 0 ? pad(cell.hour) : ""}
              </span>
            ))}
          </div>
          <figcaption
            id={captionId}
            className={
              model.peak ? "sr-only" : "m-0 text-sm text-text-secondary"
            }
          >
            {figure}
          </figcaption>
        </figure>
      )}
      {counters.length ? (
        <dl
          data-slot="heatmap-counters"
          className="m-0 flex flex-wrap gap-x-9 gap-y-4"
        >
          {counters.map((counter) => (
            <div key={counter.key} className="flex min-w-0 flex-col gap-1.5">
              <MonoLabel as="dt" className="order-last">
                {counter.label}
              </MonoLabel>
              <dd className="m-0 min-w-0">
                <StatNumber size="sm" value={counter.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Card>
  );
}

const HeatmapGrid = memo(function HeatmapGrid({
  gridRef,
  model,
  labels,
  nowLabel,
  weekdays,
  active,
  nowIndex,
  entering,
  gridLabel,
  captionId,
  onKeyDown,
  onFocus,
  onClick,
  onPointerOver,
  onPointerLeave,
  onAnimationEnd,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  model: HeatmapModel;
  labels: string[][];
  /** Accessible name of the now cell, or null. */
  nowLabel: string | null;
  weekdays: string[];
  active: number;
  nowIndex: number | null;
  entering: boolean;
  gridLabel: string;
  captionId: string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: (event: FocusEvent<HTMLDivElement>) => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerOver: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onAnimationEnd: (event: AnimationEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={gridLabel}
      aria-describedby={captionId}
      className="stats-heatmap"
      data-entering={entering ? "" : undefined}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      onAnimationEnd={onAnimationEnd}
    >
      {model.rows.map((row, weekday) => (
        <div key={weekday} role="row" className="stats-heatmap-row">
          <span className="stats-heatmap-label" aria-hidden="true">
            {weekdays[weekday]}
          </span>
          {row.map((cell) => {
            const now = cell.index === nowIndex;
            return (
              <div
                key={cell.hour}
                role="gridcell"
                tabIndex={cell.index === active ? 0 : -1}
                aria-label={
                  now && nowLabel ? nowLabel : labels[weekday]![cell.hour]
                }
                className="stats-heatmap-cell"
                data-cell={cell.index}
                data-night={cell.night ? "" : undefined}
                data-glow={cell.glow ? "" : undefined}
                data-peak={cell.peak ? "" : undefined}
                data-now={now ? "" : undefined}
                style={cell.vars as CSSProperties}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
});
