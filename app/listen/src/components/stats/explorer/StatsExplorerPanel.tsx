import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";
import { ArrowLeft, CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Button } from "@crate/ui/shadcn/button";

import { formatStatsMinutes, formatStatsPercent } from "../stats-format";
import type {
  StatsRange,
  StatsRangeAlbum,
  StatsRangeArtist,
  StatsRangeTrack,
} from "../stats-types";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "../../../lib/library-routes";
import { cn } from "../../../lib/utils";

import {
  formatExplorerDay,
  formatExplorerLongDay,
  formatExplorerRange,
} from "./stats-explorer-chart";
import type { StretchSummary } from "./stats-explorer-model";

type RenderImage = MediaCoverProps["renderImage"];

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
}

export interface StatsExplorerPanelProps {
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

function albumCover(
  item: { album?: string | null; artist?: string | null } & Pick<
    StatsRangeAlbum,
    "album_id" | "global_album_uid"
  >,
): string | null {
  if (!item.album) return null;
  return (
    albumCoverApiUrl(
      {
        albumId: item.album_id,
        globalAlbumUid: item.global_album_uid,
        albumName: item.album,
        artistName: item.artist ?? undefined,
      },
      { size: 128 },
    ) || null
  );
}

export function StatsExplorerPanel({
  granularity,
  stretch,
  summary,
  data,
  loading,
  error = false,
  stale = false,
  available,
  day,
  onBack,
  onPlayTrack,
  renderImage,
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
          renderImage={renderImage}
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
          stale={stale}
          available={available}
          onPlayTrack={onPlayTrack}
          renderImage={renderImage}
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
  stale,
  available,
  onPlayTrack,
  renderImage,
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
      {data && !available ? (
        <p className="stats-explorer-block m-0 text-sm text-text-muted">
          {t("stats.explorer.unavailable")}
        </p>
      ) : data ? (
        // While the next stretch loads, the previous blocks stay (dimmed) so
        // the stacked panel does not jump; fresh client numbers sit above.
        <div className="stats-explorer-server" data-stale={stale || undefined}>
          {artist ? (
            <PanelBlock label={t("stats.explorer.topArtist")}>
              <ArtistRow artist={artist} renderImage={renderImage} />
            </PanelBlock>
          ) : null}
          {album ? (
            <PanelBlock label={t("stats.explorer.topAlbum")}>
              <AlbumRow album={album} renderImage={renderImage} />
            </PanelBlock>
          ) : null}
          {track ? (
            <PanelBlock label={t("stats.explorer.topTrack")}>
              <TrackRow
                track={track}
                onPlayTrack={onPlayTrack}
                renderImage={renderImage}
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
  renderImage,
}: {
  headingId: string;
  granularity: "day" | "week";
  day: ExplorerDayDetail;
  onBack: () => void;
  onPlayTrack: (track: StatsRangeTrack) => void;
  renderImage?: RenderImage;
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
  } else if (day.error) {
    body = <ErrorLine />;
  } else if (!day.available) {
    body = (
      <p className="m-0 text-sm text-text-muted">
        {t("stats.explorer.unavailable")}
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
            <TrackRow
              track={track}
              onPlayTrack={onPlayTrack}
              renderImage={renderImage}
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
}: {
  artist: StatsRangeArtist;
  renderImage?: RenderImage;
}) {
  const route = {
    artistId: artist.artist_id,
    artistSlug: artist.artist_slug,
    artistName: artist.artist_name,
  };
  const linked = artist.artist_id != null || Boolean(artist.artist_slug);
  return (
    <EntityRow
      title={artist.artist_name}
      subtitle={`${formatStatsMinutes(artist.minutes)} · ${formatStatsPercent(
        artist.share,
      )}`}
      shape="circle"
      cover={{
        src:
          artist.artist_id != null
            ? artistPhotoApiUrl(route, { size: 128 })
            : null,
        alt: "",
        renderImage,
      }}
      href={linked ? artistPagePath(route) : undefined}
      menuButton="none"
      density="compact"
    />
  );
}

function AlbumRow({
  album,
  renderImage,
}: {
  album: StatsRangeAlbum;
  renderImage?: RenderImage;
}) {
  const linked = album.album_id != null || Boolean(album.global_album_uid);
  return (
    <EntityRow
      title={album.album ?? ""}
      subtitle={album.artist ?? undefined}
      meta={formatStatsMinutes(album.minutes)}
      cover={{ src: albumCover(album), alt: "", renderImage }}
      href={
        linked
          ? albumPagePath({
              albumId: album.album_id,
              albumSlug: album.album_slug,
              albumName: album.album ?? undefined,
              artistName: album.artist ?? undefined,
              globalAlbumUid: album.global_album_uid,
            })
          : undefined
      }
      menuButton="none"
      density="compact"
    />
  );
}

function TrackRow({
  track,
  onPlayTrack,
  renderImage,
  withAlbum = false,
}: {
  track: StatsRangeTrack;
  onPlayTrack: (track: StatsRangeTrack) => void;
  renderImage?: RenderImage;
  withAlbum?: boolean;
}) {
  const { t } = useTranslation();
  const subtitle = [track.artist, withAlbum ? track.album : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <EntityRow
      title={track.title ?? ""}
      subtitle={subtitle || undefined}
      meta={t("stats.explorer.plays", { count: track.plays })}
      cover={{ src: albumCover(track), alt: "", renderImage }}
      trailing={
        track.track_id != null ? (
          <ActionButton
            label={t("actions.track.playNow")}
            onClick={() => onPlayTrack(track)}
          >
            <Play aria-hidden="true" />
          </ActionButton>
        ) : undefined
      }
      menuButton="none"
      density="compact"
    />
  );
}
