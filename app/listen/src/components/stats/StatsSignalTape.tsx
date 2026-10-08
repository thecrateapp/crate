import {
  memo,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  formatStatsMinutes,
  type StatsTape,
} from "@/components/stats/stats-model";
import {
  TAPE_HEIGHT,
  TAPE_WIDTH,
  buildTapeModel,
  tapeIndexAt,
  type TapeModel,
} from "@/components/stats/stats-tape-model";
import { albumCoverApiUrl } from "@/lib/library-routes";

export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export const TapeBars = memo(function TapeBars({
  model,
}: {
  model: TapeModel;
}) {
  return (
    <svg
      viewBox={`0 0 ${TAPE_WIDTH} ${TAPE_HEIGHT}`}
      preserveAspectRatio="none"
      className="stats-signal-svg"
      aria-hidden="true"
    >
      {model.bars.map((bar) => (
        <rect
          key={bar.bucket}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          className="stats-signal-bar"
          data-hot={bar.hot ? "true" : undefined}
          data-today={bar.today ? "true" : undefined}
          style={{ animationDelay: `${bar.delayMs}ms` }}
        />
      ))}
      {model.moodPath ? (
        <path d={model.moodPath} pathLength={1} className="stats-signal-mood" />
      ) : null}
    </svg>
  );
});

export function StatsSignalTape({ tape }: { tape: StatsTape }) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const model = useMemo(
    () => buildTapeModel(tape, { locale: i18n.language, today: localToday() }),
    [i18n.language, tape],
  );
  const count = model.bars.length;

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setActiveIndex(tapeIndexAt(event.clientX - rect.left, rect.width, count));
    },
    [count],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setActiveIndex((current) => {
        const base = current ?? count - 1;
        const next = event.key === "ArrowLeft" ? base - 1 : base + 1;
        return Math.min(count - 1, Math.max(0, next));
      });
    },
    [count],
  );

  const totalMinutes = tape.points.reduce(
    (sum, point) => sum + point.minutes,
    0,
  );

  return (
    <div className="stats-signal">
      <div
        className="stats-signal-tape"
        role="group"
        tabIndex={0}
        aria-label={t("stats.signal.tapeLabel", {
          minutes: formatStatsMinutes(totalMinutes),
          count,
        })}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <TapeBars
          key={`${tape.start}:${tape.granularity}:${count}`}
          model={model}
        />
        {activeIndex !== null && count ? (
          <TapeCursor tape={tape} model={model} index={activeIndex} />
        ) : null}
      </div>
      <div className="stats-signal-axis" aria-hidden="true">
        {model.axis.map((label) => (
          <span key={label.key} style={{ left: `${label.position * 100}%` }}>
            {label.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <i className="stats-signal-legend-bar" />
          {tape.granularity === "week"
            ? t("stats.signal.legend.weekMinutes")
            : t("stats.signal.legend.dayMinutes")}
        </span>
        <span className="flex items-center gap-2">
          <i className="stats-signal-legend-bar" data-hot="true" />
          {t("stats.signal.legend.peaks")}
        </span>
        {model.moodPath ? (
          <span className="flex items-center gap-2">
            <i className="stats-signal-legend-line" />
            {t("stats.signal.legend.energy")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TapeCursor({
  tape,
  model,
  index,
}: {
  tape: StatsTape;
  model: TapeModel;
  index: number;
}) {
  const { t, i18n } = useTranslation();
  const point = tape.points[index];
  if (!point) return null;
  const position = (index + 0.5) / tape.points.length;
  const month = model.monthsByKey.get(point.bucket.slice(0, 7));
  const peak = model.peaksByBucket.get(point.bucket);
  const album = month?.top_album;
  const cover = album?.album
    ? albumCoverApiUrl(
        {
          albumId: album.album_id,
          globalAlbumUid: album.global_album_uid,
          albumName: album.album,
          artistName: album.artist,
        },
        { size: 128 },
      )
    : null;
  const date = new Date(`${point.bucket}T00:00:00Z`).toLocaleDateString(
    i18n.language,
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  );

  return (
    <>
      <div
        className="stats-signal-cursor"
        style={{ left: `${position * 100}%` }}
      />
      <div
        className="stats-signal-tip"
        data-side={position > 0.7 ? "left" : "right"}
        style={{ left: `${position * 100}%` }}
        aria-live="polite"
      >
        {cover ? (
          <CrateImage
            src={cover}
            alt=""
            className="size-11 rounded-sm object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-text-primary">
            {tape.granularity === "week"
              ? t("stats.signal.tip.weekOf", { date })
              : date}
          </div>
          <div className="text-xs text-text-muted">
            {t("stats.signal.tip.minutes", {
              minutes: formatStatsMinutes(point.minutes),
              plays: point.plays,
            })}
          </div>
          {peak?.kind === "obsession" && peak.track?.title ? (
            <div className="truncate text-xs text-accent-action">
              {t("stats.signal.tip.obsession", {
                count: peak.value,
                title: peak.track.title,
              })}
            </div>
          ) : album?.album ? (
            <div className="truncate text-xs text-text-secondary">
              {album.album}
              {album.artist ? ` · ${album.artist}` : ""}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
