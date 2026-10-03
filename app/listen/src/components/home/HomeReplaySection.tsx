import { useTranslation } from "react-i18next";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { Clock3, Play, Sparkles } from "@crate/ui/icons";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { albumCoverApiUrl } from "@/lib/library-routes";

import { SectionHeader } from "./HomeSections";
import type { ReplayMix, ReplayTrack } from "./home-model";

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
  onOpenStats,
  onPlayReplay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  replayPreview: ReplayTrack[];
  onOpenStats: () => void;
  onPlayReplay: () => void;
  onPlayTrack: (track: ReplayTrack) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  if (!replayPreview.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        subtitle={
          replay?.title && replay?.subtitle
            ? `${replay.title} · ${replay.subtitle}`
            : t("home.replay.sectionSubtitle")
        }
        actionLabel={isDesktop ? t("home.replay.openPulse") : undefined}
        onAction={isDesktop ? onOpenStats : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="home-replay-card overflow-hidden rounded-[12px] p-5">
          <div className="home-replay-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]">
            <Sparkles size={12} />
            {t("home.sections.listeningDna.title")}
          </div>
          <h2 className="mt-4 text-2xl font-bold text-text-primary">
            {replay?.title || t("home.replay.thisMonth")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {replay?.subtitle || t("home.replay.recap")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-xs uppercase tracking-[0.16em]">
                {t("home.replay.tracks")}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {replay?.track_count ?? 0}
              </div>
            </div>
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-xs uppercase tracking-[0.16em]">
                {t("home.replay.timeListened")}
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {Math.round(replay?.minutes_listened ?? 0)}m
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onPlayReplay}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
          >
            <Play size={15} fill="currentColor" />
            {t("home.replay.play")}
          </button>
        </div>

        <div className="home-replay-panel overflow-hidden rounded-[12px] p-4">
          <div className="home-replay-panel-kicker mb-3 flex items-center gap-2 text-xs uppercase tracking-wider">
            <Clock3 size={12} />
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
