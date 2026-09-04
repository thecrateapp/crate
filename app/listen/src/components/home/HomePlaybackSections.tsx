import { useMemo } from "react";
import { Clock3, Disc3, Play, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import type { Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import type { ReplayMix, ReplayTrack } from "./home-model";
import {
  ContinueListeningCard,
  SectionHeader,
  SectionRail,
} from "./HomeSections";

function HomeTrackRowAction({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onPlay,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-playback-row group/row flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
    >
      <div className="relative h-11 w-11 shrink-0">
        <TrackCoverThumb
          src={track.albumCover}
          iconSize={16}
          className="absolute inset-0 rounded-xl"
        />
        <div className="home-playback-cover-overlay absolute inset-0 flex items-center justify-center rounded-xl">
          <Play
            size={15}
            fill="currentColor"
            className="home-playback-cover-play-icon"
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {track.title}
        </div>
        <div className="truncate text-xs text-text-muted">{track.artist}</div>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-8 w-8 opacity-80 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: track.albumCover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

function HomeReplayRowAction({
  item,
  onPlay,
}: {
  item: ReplayTrack;
  onPlay: () => void;
}) {
  const cover = replayCoverUrl(item);
  const menuTrack = useMemo(
    () => ({
      id: item.track_id ?? item.track_path ?? item.title,
      global_track_uid: item.global_track_uid ?? undefined,
      title: item.title,
      artist: item.artist,
      artist_id: item.artist_id ?? undefined,
      global_artist_uid: item.global_artist_uid ?? undefined,
      artist_slug: item.artist_slug ?? undefined,
      album: item.album,
      album_id: item.album_id ?? undefined,
      global_album_uid: item.global_album_uid ?? undefined,
      album_slug: item.album_slug ?? undefined,
      path: item.track_path ?? undefined,
      library_track_id: item.track_id ?? undefined,
    }),
    [item],
  );
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: cover,
    onPlayNowOverride: onPlay,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-playback-row group/row flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
    >
      <div className="relative h-11 w-11 shrink-0">
        <TrackCoverThumb
          src={cover}
          iconSize={16}
          className="absolute inset-0 rounded-xl"
        />
        <div className="home-playback-cover-overlay absolute inset-0 flex items-center justify-center rounded-xl">
          <Play
            size={15}
            fill="currentColor"
            className="home-playback-cover-play-icon"
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {item.title}
        </div>
        <div className="truncate text-xs text-text-muted">{item.artist}</div>
      </div>
      <span className="home-replay-count-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
        {item.play_count}×
      </span>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-8 w-8 opacity-80 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.title,
          subtitle: item.artist,
          detail: item.album,
          imageUrl: cover,
          imageAlt: item.album ? `${item.title} cover` : item.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

function HomeQueueCardAction({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onPlay,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-queue-card group w-[220px] flex-shrink-0 cursor-pointer overflow-hidden rounded-xl text-left"
    >
      <div className="flex items-center gap-3 p-3">
        <div className="relative h-16 w-16 shrink-0">
          <TrackCoverThumb
            src={track.albumCover}
            iconSize={18}
            className="absolute inset-0 rounded-xl"
          />
          <div className="home-playback-cover-overlay absolute inset-0 flex items-center justify-center rounded-xl">
            <Play
              size={18}
              fill="currentColor"
              className="home-playback-cover-play-icon"
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">
            {track.title}
          </div>
          <div className="mt-1 truncate text-xs text-text-muted">
            {track.artist}
          </div>
          {track.album ? (
            <div className="home-playback-album-text mt-1 truncate text-[11px]">
              {track.album}
            </div>
          ) : null}
        </div>
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="h-8 w-8 self-start opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: track.albumCover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
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

export function ContinueListeningSection({
  continueLead,
  continueRail,
  onPlayTrack,
}: {
  continueLead?: Track;
  continueRail: Track[];
  onPlayTrack: (track: Track, sourceName: string) => void;
}) {
  if (!continueLead) {
    return (
      <div className="home-playback-empty-card overflow-hidden rounded-[12px] p-6">
        <div className="max-w-2xl space-y-3">
          <div className="home-playback-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider">
            <Sparkles size={12} />
            Start listening
          </div>
          <h2 className="text-2xl font-bold text-text-primary">
            Your home should feel alive as soon as playback starts.
          </h2>
          <p className="text-sm leading-6 text-text-muted">
            Play an album, a playlist, or a curated mix and this screen will
            turn into your real listening surface: continuity, smart picks, and
            system playlists from Crate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <ContinueListeningCard
        track={continueLead}
        onPlay={() => onPlayTrack(continueLead, "Continue Listening")}
      />

      <div className="home-playback-panel overflow-hidden rounded-[12px] p-4">
        <div className="home-playback-panel-kicker mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider">
          <Clock3 size={12} />
          Recent listens
        </div>
        <div className="space-y-1">
          {continueRail.length > 0 ? (
            continueRail
              .slice(0, 4)
              .map((track) => (
                <HomeTrackRowAction
                  key={track.id}
                  track={track}
                  onPlay={() => onPlayTrack(track, "Recent Listening")}
                />
              ))
          ) : (
            <div className="home-playback-empty-state rounded-lg px-4 py-5 text-sm text-text-muted">
              Start playing music and your listening history will show up here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const isDesktop = useIsDesktop();
  if (!replayPreview.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Crate DNA"
        subtitle={
          replay?.title && replay?.subtitle
            ? `${replay.title} · ${replay.subtitle}`
            : "Your current month in Crate, with a playable replay."
        }
        actionLabel={isDesktop ? "Open Pulse" : undefined}
        onAction={isDesktop ? onOpenStats : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="home-replay-card overflow-hidden rounded-[12px] p-5">
          <div className="home-replay-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em]">
            <Sparkles size={12} />
            Crate DNA
          </div>
          <h2 className="mt-4 text-2xl font-bold text-text-primary">
            {replay?.title || "This month"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {replay?.subtitle || "A playable recap of your current month."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-[10px] uppercase tracking-[0.16em]">
                Tracks
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {replay?.track_count ?? 0}
              </div>
            </div>
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-[10px] uppercase tracking-[0.16em]">
                Time listened
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {Math.round(replay?.minutes_listened ?? 0)}m
              </div>
            </div>
          </div>
          <button
            onClick={onPlayReplay}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
          >
            <Play size={15} fill="currentColor" />
            Play month replay
          </button>
        </div>

        <div className="home-replay-panel overflow-hidden rounded-[12px] p-4">
          <div className="home-replay-panel-kicker mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider">
            <Clock3 size={12} />
            Month replay
          </div>
          <div className="space-y-1">
            {replayPreview.map((item) => (
              <HomeReplayRowAction
                key={`${item.track_id ?? item.track_path ?? item.title}`}
                item={item}
                onPlay={() => onPlayTrack(item)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function KeepQueueMovingSection({
  tracks,
  onPlayTrack,
}: {
  tracks: Track[];
  onPlayTrack: (track: Track) => void;
}) {
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Keep the queue moving"
        subtitle="Quick picks from your own recent listening."
      />
      <SectionRail>
        {tracks.map((track) => (
          <HomeQueueCardAction
            key={track.id}
            track={track}
            onPlay={() => onPlayTrack(track)}
          />
        ))}
      </SectionRail>
    </section>
  );
}
