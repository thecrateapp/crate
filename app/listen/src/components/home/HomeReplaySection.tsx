import { useTranslation } from "react-i18next";
import { Clock3, CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { SectionHeader } from "@crate/ui/domain/lists";
import { Button } from "@crate/ui/shadcn/button";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { StatsMiniTape } from "@/components/stats/StatsMiniTape";
import type { StatsTape } from "@/components/stats/stats-model";
import { albumCoverApiUrl } from "@/lib/library-routes";

import type { ReplayMix, ReplayTrack } from "./home-model";

export interface HomeListeningSignal {
  days: number;
  minutes: number;
  plays: number;
  artists: number | null;
  tape: StatsTape | null;
}

function replayCoverUrl(item: ReplayTrack): string | undefined {
  if (item.album_id == null && !item.global_album_uid) return undefined;
  return albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumEntityUid: item.album_entity_uid ?? undefined,
      artistEntityUid: item.artist_entity_uid ?? undefined,
      albumSlug: item.album_slug ?? undefined,
      artistName: item.artist,
      albumName: item.album,
    },
    { size: 256 },
  );
}

function replayTrackRowData(item: ReplayTrack): TrackRowData {
  return {
    id: item.track_id ?? item.track_path ?? item.title,
    library_track_id: item.track_id ?? undefined,
    entity_uid: item.track_entity_uid ?? undefined,
    global_track_uid: item.global_track_uid ?? undefined,
    title: item.title,
    artist: item.artist,
    artist_id: item.artist_id ?? undefined,
    artist_entity_uid: item.artist_entity_uid ?? undefined,
    global_artist_uid: item.global_artist_uid ?? undefined,
    artist_slug: item.artist_slug ?? undefined,
    album: item.album,
    album_id: item.album_id ?? undefined,
    album_entity_uid: item.album_entity_uid ?? undefined,
    global_album_uid: item.global_album_uid ?? undefined,
    album_slug: item.album_slug ?? undefined,
    path: item.track_path ?? undefined,
  };
}

export function HomeReplaySection({
  replay,
  replayPreview,
  signal,
  onOpenStats,
  onPlayReplay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  replayPreview: ReplayTrack[];
  signal?: HomeListeningSignal | null;
  onOpenStats: () => void;
  onPlayReplay: () => void;
  onPlayTrack: (track: ReplayTrack) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!replayPreview.length) return null;

  const formatInteger = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
      Math.round(value),
    );
  const metrics = signal
    ? [
        {
          key: "minutes",
          value: signal.minutes,
          label: t("stats.headline.minutes"),
        },
        { key: "plays", value: signal.plays, label: t("stats.headline.plays") },
        ...(signal.artists === null
          ? []
          : [
              {
                key: "artists",
                value: signal.artists,
                label: t("stats.headline.artists"),
              },
            ]),
      ]
    : [
        {
          key: "tracks",
          value: replay?.track_count ?? 0,
          label: t("home.replay.tracks"),
        },
        {
          key: "minutes",
          value: replay?.minutes_listened ?? 0,
          label: t("stats.headline.minutes"),
        },
      ];

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        actionLabel={t("home.sections.listeningDna.action")}
        onAction={onOpenStats}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
        <div className="home-replay-card flex flex-col overflow-hidden rounded-panel p-6">
          <div className="text-sm font-semibold text-accent-action">
            {replay?.title || t("home.replay.thisMonth")}
          </div>
          <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-text-primary">
            {signal
              ? t("stats.signal.title.days", { count: signal.days })
              : t("home.replay.recap")}{" "}
            {signal ? (
              <span className="text-accent-action">
                {t("stats.signal.title.accent")}
              </span>
            ) : null}
          </h2>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            {metrics.map((metric) => (
              <div key={metric.key}>
                <dd className="text-2xl font-extrabold tabular-nums text-text-primary">
                  {formatInteger(metric.value)}
                </dd>
                <dt className="text-xs text-text-muted">{metric.label}</dt>
              </div>
            ))}
          </dl>
          {signal?.tape?.points.length ? (
            <StatsMiniTape tape={signal.tape} />
          ) : null}
          <Button onClick={onPlayReplay} className="mt-auto self-start">
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {t("home.replay.play")}
          </Button>
        </div>

        <div className="home-replay-panel overflow-hidden rounded-panel p-4">
          <div className="home-replay-panel-kicker mb-3 flex items-center gap-2 text-xs uppercase tracking-wider">
            <Clock3 size={CRATE_ICON_SIZE.micro} />
            {t("home.replay.title")}
          </div>
          <div className="space-y-1">
            {replayPreview.map((item) => (
              <TrackRow
                key={`${item.track_id ?? item.track_path ?? item.title}`}
                track={replayTrackRowData(item)}
                albumCover={replayCoverUrl(item)}
                showCoverThumb
                showArtist
                showDuration={false}
                meta={`${item.play_count}×`}
                onPlayOverride={() => onPlayTrack(item)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
