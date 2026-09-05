import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import {
  FullscreenPlayerInfoTab,
  FullscreenPlayerLyricsTab,
  FullscreenPlayerPlayerTab,
  FullscreenPlayerQueueTab,
} from "@/components/player/FullscreenPlayerTabs";
import type { FullscreenPlayerViewProps } from "@/components/player/fullscreen-player-view-types";
import type { FSPanel } from "@/components/player/fullscreen-player-types";
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
        <FullscreenPlayerInfoTab
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
    </div>
  );
}
