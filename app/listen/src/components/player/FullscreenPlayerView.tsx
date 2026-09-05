import { useMemo } from "react";
import type { TFunction } from "i18next";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";
import { FullscreenPlayerArtwork } from "@/components/player/FullscreenPlayerArtwork";
import { FullscreenPlayerControls } from "@/components/player/FullscreenPlayerControls";
import type {
  FullscreenPlayerViewProps,
  ViewPlayer,
  ViewRefs,
} from "@/components/player/fullscreen-player-view-types";
import type {
  FSPanel,
  FullscreenLyrics,
} from "@/components/player/fullscreen-player-types";
import type { Track } from "@/contexts/player-types";
import {
  ChevronDown,
  Disc3,
  Info,
  ListMusic,
  Mic3,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { triggerHaptic } from "@/lib/haptics";

function FullscreenQueueRow({
  track,
  onJump,
}: {
  track: Track;
  onJump: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onJump,
  });
  const actionMenu = useItemActionMenu(actions);

  const jumpWithFeedback = () => {
    triggerHaptic("selection");
    onJump();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={jumpWithFeedback}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpWithFeedback();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="flex w-full items-center gap-3 rounded-lg py-2 text-left transition-colors active:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
    >
      {track.albumCover ? (
        <CrateImage
          src={track.albumCover}
          alt=""
          loading="lazy"
          className="h-8 w-8 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-surface-control-hover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm text-text-primary">
            {track.title}
          </p>
          {track.isSuggested ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-action">
              Suggested
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-text-muted">{track.artist}</p>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-11 w-11 shrink-0 opacity-85 transition-opacity hover:opacity-100"
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

function FullscreenPlayerHeader({
  activePanel,
  onClose,
  onSelectPanel,
  t,
}: Pick<FullscreenPlayerViewProps, "t" | "onSelectPanel"> & {
  activePanel: FSPanel | null;
  onClose: () => void;
}) {
  const panelSwitches: {
    id: FSPanel;
    icon: typeof Disc3;
    label: string;
  }[] = [
    { id: "queue", icon: ListMusic, label: t("player.queue") },
    { id: "lyrics", icon: Mic3, label: t("player.lyrics") },
    { id: "info", icon: Info, label: t("player.info") },
  ];

  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("player.close")}
        className="-ml-2 flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center text-text-secondary active:text-text-primary"
      >
        <ChevronDown size={28} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        {panelSwitches.map(({ id, icon: Icon, label }) => {
          const selected = activePanel === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => {
                triggerHaptic("selection");
                onSelectPanel((current) => (current === id ? null : id));
              }}
              className={cn(
                "group relative flex h-14 min-w-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold leading-none transition-[color,filter,transform] active:scale-[0.96]",
                selected
                  ? "text-accent-action drop-shadow-accent-action-icon"
                  : "text-text-muted active:text-text-secondary",
              )}
            >
              <Icon
                size={CRATE_ICON_SIZE.xl}
                className="transition-transform group-active:scale-95"
              />
              <span>{label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0 h-0.5 w-4 rounded-full transition-[opacity,box-shadow]",
                  selected
                    ? "bg-accent-action opacity-100 shadow-accent-action-indicator-active"
                    : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FullscreenPlayerPlayerTab({
  state,
  player,
  refs,
  actions,
  t,
  playerTabBottomClearance,
  markArtistPhotoFailed,
}: Pick<
  FullscreenPlayerViewProps,
  "state" | "player" | "refs" | "actions" | "t" | "playerTabBottomClearance"
> & {
  markArtistPhotoFailed: () => void;
}) {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6"
      style={{ paddingBottom: playerTabBottomClearance }}
    >
      <div className="relative z-10 mx-auto w-full max-w-[360px]">
        <FullscreenPlayerArtwork
          state={state}
          player={player}
          refs={refs}
          actions={actions}
        />
      </div>
      <div className="relative z-10 mt-5 w-full text-center">
        <PlayerTrackIdentity
          currentTrack={player.currentTrack}
          crossfadeTransition={player.crossfadeTransition}
          crossfadeProgress={player.crossfadeProgress}
          sourceLabel={player.sourceLabel}
          artistAvatarUrl={player.artistAvatarUrl}
          onArtistAvatarError={markArtistPhotoFailed}
          onArtistClick={actions.goToArtist}
          artistClickable={!!player.resolvedArtist?.id}
          titleClassName="text-lg"
          albumClassName="text-xs"
        />
        <div className="mx-auto mt-4 w-full max-w-[360px]">
          <div className="fullscreen-player-time mb-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums">
            <span>{formatPlayerTime(player.displayedTime)}</span>
            <span>-{formatPlayerTime(player.effectiveRemainingTime)}</span>
          </div>
          <PlayerSeekBar
            currentTime={player.displayedTime}
            duration={player.displayedDuration}
            onSeek={actions.seekWithFeedback}
            disabled={state.jamQueueLocked}
            thin
            variant="glow"
          />
        </div>
        <FullscreenPlayerControls
          state={state}
          player={player}
          actions={actions}
          t={t}
        />
      </div>
    </div>
  );
}

function FullscreenPlayerQueueTab({
  player,
  t,
  jumpTo,
  scrollTabBottomClearance,
}: {
  player: ViewPlayer;
  t: TFunction;
  jumpTo: (index: number) => void;
  scrollTabBottomClearance: string;
}) {
  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
          {t("player.queue.upNextTracks", {
            count: player.upcomingTracks.length,
          })}
        </p>
        {player.upcomingTracks.length === 0 && (
          <p className="py-2 text-sm text-text-faint">
            {t("player.queue.nothingQueued")}
          </p>
        )}
        {player.upcomingTracks.map((track, index) => (
          <FullscreenQueueRow
            key={`${track.id}-${index}`}
            track={track}
            onJump={() => jumpTo(index)}
          />
        ))}
      </div>
    </div>
  );
}

function FullscreenPlayerLyricsTab({
  activeLyricIndex,
  lyrics,
  refs,
  seek,
  t,
  scrollTabBottomClearance,
}: {
  activeLyricIndex: number;
  lyrics: FullscreenLyrics | null;
  refs: ViewRefs;
  seek: (time: number) => void;
  t: TFunction;
  scrollTabBottomClearance: string;
}) {
  return (
    <div
      ref={refs.lyricsContainerRef}
      className="relative flex-1 overflow-y-auto px-5 py-4"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <div
        aria-hidden="true"
        className="lyrics-fullscreen-backdrop pointer-events-none absolute inset-0 opacity-70"
      />
      {!lyrics ? (
        <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
          {t("player.lyrics.loading")}
        </p>
      ) : lyrics.synced ? (
        <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-start gap-3 py-8">
          {lyrics.synced.map((line, index) => {
            const active = index === activeLyricIndex;
            const past = index < activeLyricIndex;
            return (
              <button
                key={`${line.time}-${index}`}
                type="button"
                ref={active ? refs.activeLyricRef : null}
                onClick={() => {
                  triggerHaptic("selection");
                  seek(line.time);
                }}
                className={cn(
                  "w-full rounded-xl px-1 py-1 text-left font-extrabold tracking-normal transition-[color,filter,opacity,transform] duration-500",
                  active
                    ? "lyrics-active-line text-[1.9rem] leading-[1.08] text-text-primary opacity-100"
                    : past
                      ? "text-[1.55rem] leading-[1.12] text-text-faint opacity-75 blur-[0.7px]"
                      : "text-[1.55rem] leading-[1.12] text-text-subtle opacity-85 blur-[0.35px]",
                )}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : lyrics.plain ? (
        <pre className="relative z-10 mx-auto max-w-[560px] whitespace-pre-wrap py-8 text-left text-[1.45rem] font-extrabold leading-[1.16] text-text-primary">
          {lyrics.plain}
        </pre>
      ) : (
        <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
          {t("player.lyrics.unavailable")}
        </p>
      )}
    </div>
  );
}

export function FullscreenPlayerView({
  t,
  state,
  player,
  refs,
  actions,
  lyrics,
  activeLyricIndex,
  playerTabBottomClearance,
  scrollTabBottomClearance,
  onSelectPanel,
  setShowEqualizer,
  markArtistPhotoFailed,
}: FullscreenPlayerViewProps) {
  return (
    <div
      ref={refs.fsRootRef}
      className={`fullscreen-player-surface fixed inset-0 z-fullscreen-player flex flex-col ease-out ${
        state.animating ? "opacity-100" : "opacity-0 translate-y-full"
      }`}
      style={{
        minHeight: "var(--listen-viewport-height)",
        height: "var(--listen-viewport-height)",
        transform:
          state.swipeY > 0 ? `translateY(${state.swipeY}px)` : undefined,
        transition: state.swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity:
          state.swipeY > 0 ? Math.max(0.3, 1 - state.swipeY / 400) : undefined,
      }}
      onTouchStart={actions.onSwipeStart}
      onTouchMove={actions.onSwipeMove}
      onTouchEnd={actions.onSwipeEnd}
    >
      <div
        className="flex justify-center pb-1"
        style={{ paddingTop: "calc(var(--listen-safe-top) + 0.75rem)" }}
      >
        <div className="fullscreen-player-handle h-1 w-10 rounded-full" />
      </div>
      <FullscreenPlayerHeader
        activePanel={state.activePanel}
        onClose={actions.closeWithFeedback}
        onSelectPanel={onSelectPanel}
        t={t}
      />
      {state.allowMobileEqualizer && state.showEqualizer ? (
        <div
          ref={refs.equalizerRef}
          className="listen-mobile-eq-glass absolute left-4 right-4 z-40 overflow-y-auto rounded-xl p-4 animate-fade-slide-up"
          style={{
            top: "var(--listen-mobile-fullscreen-eq-top)",
            maxHeight:
              "calc(var(--listen-viewport-height) - var(--listen-mobile-fullscreen-eq-top) - var(--listen-safe-bottom) - 1rem)",
          }}
        >
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </div>
      ) : null}
      {state.activePanel === null ? (
        <FullscreenPlayerPlayerTab
          state={state}
          player={player}
          refs={refs}
          actions={actions}
          t={t}
          playerTabBottomClearance={playerTabBottomClearance}
          markArtistPhotoFailed={markArtistPhotoFailed}
        />
      ) : null}
      {state.activePanel === "queue" ? (
        <FullscreenPlayerQueueTab
          player={player}
          t={t}
          jumpTo={actions.jumpTo}
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
      {state.activePanel === "lyrics" ? (
        <FullscreenPlayerLyricsTab
          activeLyricIndex={activeLyricIndex}
          lyrics={lyrics}
          refs={refs}
          seek={actions.seek}
          t={t}
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
      {state.activePanel === "info" ? (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3"
          style={{ paddingBottom: scrollTabBottomClearance }}
        >
          <InfoTab className="pr-0" />
        </div>
      ) : null}
    </div>
  );
}
