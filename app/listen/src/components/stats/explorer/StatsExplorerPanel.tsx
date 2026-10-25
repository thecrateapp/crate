import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";
import { ArrowLeft, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Button } from "@crate/ui/shadcn/button";

import {
  HEATMAP_HIDDEN_FEW_LISTENERS,
  HEATMAP_MIN_LISTENERS,
} from "../heatmap-model";
import { formatStatsMinutes, formatStatsPercent } from "../stats-format";
import type {
  StatsRange,
  StatsRangeAlbum,
  StatsRangeArtist,
  StatsRangeTrack,
} from "../stats-types";
import { cn } from "../../../lib/utils";

import {
  formatExplorerDay,
  formatExplorerLongDay,
  formatExplorerRange,
} from "./stats-explorer-chart";
import type { StretchSummary } from "./stats-explorer-model";

type RenderImage = MediaCoverProps["renderImage"];
type TrackRenderer = (track: StatsRangeTrack, withAlbum: boolean) => ReactNode;
import { StatsRangeTrackView } from "./StatsRangeTrackView";

/** What played in one bucket: a day, or a week on weekly tapes. */
export interface ExplorerDayDetail {
  bucket: string;
  /** Inclusive local days of the bucket. */
  start: string;
  end: string;
  minutes: number;
  plays: number;
  tracks: StatsRangeTrack[];
  loading: boolean;
  /** The request failed: never shown as "nothing played". */
  error: boolean;
  available: boolean;
  hiddenReason?: string | null;
  unsupported?: boolean;
}

/** Artwork and page links, supplied by the adapter so this view stays pure. */
export interface ExplorerLinks {
  /** Cover for an album or the album of a track; null when there is none. */
  albumCover: (
    item: { album?: string | null; artist?: string | null } & Pick<
      StatsRangeAlbum,
      "album_id" | "global_album_uid"
    >,
  ) => string | null;
  artistPhoto: (artist: StatsRangeArtist) => string | null;
  /** Undefined when the artist has no page. */
  artistHref: (artist: StatsRangeArtist) => string | undefined;
  /** Undefined when the album has no page. */
  albumHref: (album: StatsRangeAlbum) => string | undefined;
}

export interface StatsExplorerPanelProps {
  links: ExplorerLinks;
  granularity: "day" | "week";
  /** Inclusive local days of the stretch. */
  stretch: { start: string; end: string };
  summary: StretchSummary;
  data: StatsRange | null;
  loading: boolean;
  /** The stretch request failed and there is nothing to show for it. */
  error?: boolean;
  /** `data` belongs to the previous stretch; shown dimmed while this one loads. */
  stale?: boolean;
  available: boolean;
  day: ExplorerDayDetail | null;
  onBack: () => void;
  onPlayTrack: (track: StatsRangeTrack) => void;
  renderImage?: RenderImage;
  renderTrack?: TrackRenderer;
  unsupported?: boolean;
}

const DAY_MS = 86_400_000;
const MOOD_SPLIT = 0.5;
const UNKNOWN = "—";

function daysBetween(range: { start: string; end: string }): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / DAY_MS) + 1);
}

function moodKey(energy: number, valence: number): string {
  if (energy >= MOOD_SPLIT) return valence >= MOOD_SPLIT ? "happy" : "intense";
  return valence >= MOOD_SPLIT ? "chill" : "melancholy";
}

export function StatsExplorerPanel({
  granularity,
  stretch,
  summary,
  data,
  loading,
  error = false,
  unsupported = false,
  stale = false,
  available,
  day,
  onBack,
  onPlayTrack,
  renderTrack,
  renderImage,
  links,
}: StatsExplorerPanelProps) {
  const headingId = useId();
  const busy = day ? day.loading : loading && (!data || stale);
  return (
    <aside
      className="stats-explorer-panel"
      aria-live="polite"
      aria-busy={busy || undefined}
      aria-labelledby={headingId}
    >
      {day ? (
        <DayDetail
          headingId={headingId}
          granularity={granularity}
          day={day}
          onBack={onBack}
          onPlayTrack={onPlayTrack}
          renderTrack={renderTrack}
          renderImage={renderImage}
          links={links}
        />
      ) : (
        <StretchSummaryView
          headingId={headingId}
          granularity={granularity}
          stretch={stretch}
          summary={summary}
          data={data}
          loading={loading}
          error={error}
          unsupported={unsupported}
          stale={stale}
          available={available}
          onPlayTrack={onPlayTrack}
          renderTrack={renderTrack}
          renderImage={renderImage}
          links={links}
        />
      )}
    </aside>
  );
}

function ErrorLine({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("m-0 text-sm text-text-muted", className)}>
      {t("stats.explorer.error")}
    </p>
  );
}

function StretchSummaryView({
  headingId,
  granularity,
  stretch,
  summary,
  data,
  loading,
  error,
  unsupported,
  stale,
  available,
  onPlayTrack,
  renderTrack,
  renderImage,
  links,
}: Omit<StatsExplorerPanelProps, "day" | "onBack"> & { headingId: string }) {
  const { t, i18n } = useTranslation();
  const dates = formatExplorerRange(stretch, i18n.language);
  const artist = data?.top_artists[0];
  const album = data?.top_albums[0];
  const track = data?.top_tracks[0];

  return (
    <>
      <div className="grid gap-1">
        <MonoLabel id={headingId} tone="accent">
          {t("stats.explorer.stretch")}
        </MonoLabel>
        <MonoLabel
          meta={[
            t("stats.explorer.windowValue", dates),
            t("stats.explorer.days", { count: daysBetween(stretch) }),
          ]}
        />
      </div>
      <StatNumber size="md" value={formatStatsMinutes(summary.minutes)} />
      <p className="m-0 text-sm text-text-secondary">
        <span>
          {t("stats.explorer.average", {
            minutes: formatStatsMinutes(summary.average),
          })}
        </span>
        {/* Weekly tapes count silent weeks, not days (ruling R13). */}
        {granularity === "day" ? (
          <>
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            <span>{t("stats.explorer.silent", { count: summary.silent })}</span>
          </>
        ) : null}
      </p>
      <MoodBlock energy={summary.energy} valence={summary.valence} />
      {unsupported ? (
        <p className="stats-explorer-block m-0 text-sm text-text-muted">
          {t("stats.explorer.detailUnsupported")}
        </p>
      ) : data && !available ? (
        <p className="stats-explorer-block m-0 text-sm text-text-muted">
          {t("stats.explorer.unavailable")}
        </p>
      ) : data?.hidden_reason === HEATMAP_HIDDEN_FEW_LISTENERS ? (
        <p className="stats-explorer-block m-0 text-sm text-text-muted">
          {t("stats.explorer.fewListeners", { count: HEATMAP_MIN_LISTENERS })}
        </p>
      ) : data ? (
        // While the next stretch loads, the previous blocks stay (dimmed) so
        // the stacked panel does not jump; fresh client numbers sit above.
        <div className="stats-explorer-server" data-stale={stale || undefined}>
          {artist ? (
            <PanelBlock label={t("stats.explorer.topArtist")}>
              <ArtistRow
                artist={artist}
                renderImage={renderImage}
                links={links}
              />
            </PanelBlock>
          ) : null}
          {album ? (
            <PanelBlock label={t("stats.explorer.topAlbum")}>
              <AlbumRow album={album} renderImage={renderImage} links={links} />
            </PanelBlock>
          ) : null}
          {track ? (
            <PanelBlock label={t("stats.explorer.topTrack")}>
              <ExplorerTrack
                track={track}
                renderTrack={renderTrack}
                onPlayTrack={onPlayTrack}
                renderImage={renderImage}
                links={links}
              />
            </PanelBlock>
          ) : null}
          <PanelBlock label={t("stats.explorer.discoveries")}>
            {data.discoveries.length ? (
              <div className="flex flex-wrap gap-1.5">
                {data.discoveries.map((item) => (
                  <InfoBadge key={`${item.artist_name}:${item.first_day}`}>
                    {`${item.artist_name} · ${formatExplorerDay(
                      item.first_day,
                      i18n.language,
                    )}`}
                  </InfoBadge>
                ))}
              </div>
            ) : (
              <p className="m-0 text-sm text-text-muted">
                {t("stats.explorer.noDiscoveries")}
              </p>
            )}
          </PanelBlock>
        </div>
      ) : error ? (
        <ErrorLine className="stats-explorer-block" />
      ) : loading ? (
        <>
          <PanelBlock label={t("stats.explorer.topArtist")}>
            <span className="stats-explorer-placeholder" />
          </PanelBlock>
          <PanelBlock label={t("stats.explorer.topTrack")}>
            <span className="stats-explorer-placeholder" />
          </PanelBlock>
        </>
      ) : null}
    </>
  );
}

function DayDetail({
  headingId,
  granularity,
  day,
  onBack,
  onPlayTrack,
  renderTrack,
  renderImage,
  links,
}: {
  headingId: string;
  granularity: "day" | "week";
  day: ExplorerDayDetail;
  onBack: () => void;
  onPlayTrack: (track: StatsRangeTrack) => void;
  renderImage?: RenderImage;
  renderTrack?: TrackRenderer;
  links: ExplorerLinks;
}) {
  const { t, i18n } = useTranslation();
  const weekly = granularity === "week";
  const title = weekly
    ? t(
        "stats.explorer.windowValue",
        formatExplorerRange({ start: day.start, end: day.end }, i18n.language),
      )
    : formatExplorerLongDay(day.start, i18n.language);

  let body: ReactNode;
  if (day.minutes <= 0) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.nothingPlayed")}
      </p>
    );
  } else if (day.loading) {
    body = <span className="stats-explorer-placeholder" />;
  } else if (day.unsupported) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.detailUnsupported")}
      </p>
    );
  } else if (day.error) {
    body = <ErrorLine />;
  } else if (!day.available) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.unavailable")}
      </p>
    );
  } else if (day.hiddenReason === HEATMAP_HIDDEN_FEW_LISTENERS) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.fewListeners", { count: HEATMAP_MIN_LISTENERS })}
      </p>
    );
  } else if (!day.tracks.length) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.nothingPlayed")}
      </p>
    );
  } else {
    body = (
      <ol className="stats-explorer-tracks">
        {day.tracks.map((track, index) => (
          <li key={`${track.track_id ?? track.title}:${index}`}>
            <ExplorerTrack
              track={track}
              renderTrack={renderTrack}
              onPlayTrack={onPlayTrack}
              renderImage={renderImage}
              links={links}
              withAlbum
            />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <>
      <div className="grid gap-1">
        <MonoLabel id={headingId} tone="accent">
          {t(weekly ? "stats.explorer.week" : "stats.explorer.day")}
        </MonoLabel>
        <p className="m-0 font-display text-2xl font-bold leading-tight text-text-primary">
          {title}
        </p>
        <MonoLabel
          meta={[
            formatStatsMinutes(day.minutes),
            t("stats.explorer.plays", { count: day.plays }),
          ]}
        />
      </div>
      {body}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={onBack}
      >
        <ArrowLeft size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
        {t("stats.explorer.back")}
      </Button>
    </>
  );
}

function PanelBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="stats-explorer-block" aria-labelledby={id}>
      <MonoLabel as="h3" id={id}>
        {label}
      </MonoLabel>
      {children}
    </section>
  );
}

function MoodBlock({
  energy,
  valence,
}: {
  energy: number | null;
  valence: number | null;
}) {
  const { t } = useTranslation();
  const known = energy != null || valence != null;
  return (
    <PanelBlock label={t("stats.explorer.mood")}>
      <p className="m-0 text-sm text-text-primary">
        {energy != null && valence != null
          ? t(`explore.moods.names.${moodKey(energy, valence)}`)
          : UNKNOWN}
      </p>
      {known ? (
        <div className="grid gap-2">
          <MoodReading label={t("stats.explorer.energy")} value={energy} />
          <MoodReading label={t("stats.explorer.valence")} value={valence} />
        </div>
      ) : null}
    </PanelBlock>
  );
}

function MoodReading({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  // Unknown is not a confirmed zero: no rail, just a dash.
  if (value == null) {
    return (
      <div className="flex items-center justify-between gap-2">
        <MonoLabel as="span">{label}</MonoLabel>
        <span className="font-mono text-label text-text-muted">{UNKNOWN}</span>
      </div>
    );
  }
  return (
    <Meter
      label={label}
      value={value}
      max={1}
      valueText={formatStatsPercent(value)}
    />
  );
}

function ArtistRow({
  artist,
  renderImage,
  links,
}: {
  artist: StatsRangeArtist;
  renderImage?: RenderImage;
  links: ExplorerLinks;
}) {
  return (
    <EntityRow
      title={artist.artist_name}
      subtitle={`${formatStatsMinutes(artist.minutes)} · ${formatStatsPercent(
        artist.share,
      )}`}
      shape="circle"
      cover={{
        src: links.artistPhoto(artist),
        alt: "",
        renderImage,
      }}
      href={links.artistHref(artist)}
      menuButton="none"
      density="compact"
    />
  );
}

function AlbumRow({
  album,
  renderImage,
  links,
}: {
  album: StatsRangeAlbum;
  renderImage?: RenderImage;
  links: ExplorerLinks;
}) {
  return (
    <EntityRow
      title={album.album ?? ""}
      subtitle={album.artist ?? undefined}
      meta={formatStatsMinutes(album.minutes)}
      cover={{ src: links.albumCover(album), alt: "", renderImage }}
      href={links.albumHref(album)}
      menuButton="none"
      density="compact"
    />
  );
}

function ExplorerTrack({
  track,
  renderTrack,
  onPlayTrack,
  renderImage,
  links,
  withAlbum = false,
}: {
  track: StatsRangeTrack;
  renderTrack?: TrackRenderer;
  onPlayTrack: (track: StatsRangeTrack) => void;
  renderImage?: RenderImage;
  links: ExplorerLinks;
  withAlbum?: boolean;
}) {
  return renderTrack ? (
    renderTrack(track, withAlbum)
  ) : (
    <StatsRangeTrackView
      track={track}
      cover={links.albumCover(track)}
      renderImage={renderImage}
      withAlbum={withAlbum}
      onPlay={() => {
        if (track.track_id != null) onPlayTrack(track);
      }}
    />
  );
}
