import { useModalFocus } from "@crate/ui/lib/use-modal-focus";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { PlayerPanels } from "./PlayerPanels";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { ChevronDown, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { triggerHaptic } from "@/lib/haptics";
import {
  FullscreenPlayerInfoTab,
  FullscreenPlayerLyricsTab,
  FullscreenPlayerPlayerTab,
  FullscreenPlayerQueueTab,
} from "@/components/player/FullscreenPlayerTabs";
import type { FullscreenPlayerViewProps } from "@/components/player/fullscreen-player-view-types";
export function FullscreenPlayerView({
  t,
  open = true,
  state,
  player,
  refs,
  actions,
  lyrics,
  lyricsLoading,
  lyricsError,
  onRetryLyrics,
  activeLyricIndex,
  playerTabBottomClearance,
  scrollTabBottomClearance,
  onSelectPanel,
  setShowEqualizer,
  markArtistPhotoFailed,
}: FullscreenPlayerViewProps) {
  useModalFocus({
    active: open,
    panelRef: refs.fsRootRef,
    onEscape: actions.onEscape,
    isolate: true,
    restoreFocusTarget: () =>
      document.querySelector<HTMLElement>(
        '[data-player-surface-launcher="fullscreen"]',
      ),
  });
  return (
    <div
      ref={refs.fsRootRef}
      role="dialog"
      aria-label={t("player.queue.nowPlaying")}
      aria-modal="true"
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      data-app-modal-panel="true"
      data-modal-depth={-1}
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
      {state.allowMobileEqualizer && state.showEqualizer ? (
        <AppPopover
          ref={refs.equalizerRef}
          className="absolute left-4 right-4 z-app-player-popover overflow-y-auto rounded-xl p-4 animate-fade-slide-up"
          style={{
            top: "var(--listen-mobile-fullscreen-eq-top)",
            maxHeight:
              "calc(var(--listen-viewport-height) - var(--listen-mobile-fullscreen-eq-top) - var(--listen-safe-bottom) - 1rem)",
          }}
        >
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </AppPopover>
      ) : null}
      <PlayerPanels
        value={state.activePanel ?? "player"}
        label={t("player.tabsLabel")}
        onValueChange={(value) => {
          triggerHaptic("selection");
          onSelectPanel(
            value === "player" ? null : (value as "queue" | "lyrics" | "info"),
          );
        }}
        leading={
          <ActionButton
            label={t("player.close")}
            onClick={actions.closeWithFeedback}
          >
            <ChevronDown size={CRATE_ICON_SIZE.xl} />
          </ActionButton>
        }
        items={[
          {
            value: "player",
            label: t("player.queue.nowPlaying"),
            content: (
              <FullscreenPlayerPlayerTab
                state={state}
                player={player}
                refs={refs}
                actions={actions}
                t={t}
                playerTabBottomClearance={playerTabBottomClearance}
                markArtistPhotoFailed={markArtistPhotoFailed}
              />
            ),
          },
          {
            value: "queue",
            label: t("player.queue"),
            content: (
              <FullscreenPlayerQueueTab
                player={player}
                t={t}
                jumpTo={actions.jumpTo}
                locked={state.jamQueueLocked}
                scrollTabBottomClearance={scrollTabBottomClearance}
              />
            ),
          },
          {
            value: "lyrics",
            label: t("player.lyrics"),
            content: (
              <FullscreenPlayerLyricsTab
                activeLyricIndex={activeLyricIndex}
                lyrics={lyrics}
                lyricsLoading={lyricsLoading}
                lyricsError={lyricsError}
                onRetryLyrics={onRetryLyrics}
                refs={refs}
                seek={actions.seek}
                t={t}
                scrollTabBottomClearance={scrollTabBottomClearance}
              />
            ),
          },
          {
            value: "info",
            label: t("player.info"),
            content: (
              <FullscreenPlayerInfoTab
                scrollTabBottomClearance={scrollTabBottomClearance}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
