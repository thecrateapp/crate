import type { OfflineItemState } from "../../lib/offline-model";
import type { ReactNode, RefObject } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  CRATE_ICON_SIZE,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import {
  HeroActionBar,
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
  HERO_SECONDARY_ACTION_CLASS,
  type HeroSecondaryAction,
  type HeroActionMenu,
} from "@crate/ui/domain/hero";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { cn } from "@crate/ui/lib/cn";
export interface AlbumActionState {
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  canSaveAlbum: boolean;
  offlineSupported: boolean;
  offlineState: OfflineItemState;
  offlineBusy: boolean;
  offlineButtonLabel: string;
  offlineStatusDetail: string | null;
  saved: boolean;
  remoteOnly: boolean;
  playerTracksAvailable: boolean;
}
export interface AlbumActionHandlers {
  onAlbumRadio: () => void;
  onToggleOffline: () => void;
  onToggleSaved: () => void;
  onShare: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onMenuClose: () => void;
}
function offlineAction(
  state: AlbumActionState,
  actions: AlbumActionHandlers,
  t: (key: string, options?: Record<string, unknown>) => string,
): HeroSecondaryAction {
  const ready = state.offlineState === "ready";
  const error = state.offlineState === "error";
  return {
    key: "offline",
    label: t("common.offline"),
    icon: ready ? (
      <ArrowDownToLineBold size={CRATE_ICON_SIZE.lg} />
    ) : state.offlineBusy ? (
      <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
    ) : error ? (
      <AlertCircle size={CRATE_ICON_SIZE.lg} />
    ) : (
      <ArrowDownToLine size={CRATE_ICON_SIZE.lg} />
    ),
    onClick: actions.onToggleOffline,
    disabled: !state.offlineSupported || state.offlineBusy,
    ariaLabel: ready
      ? t("playlist.offline.removeCopy")
      : t("playlist.offline.makeAvailable"),
    title: state.offlineButtonLabel,
    className: ready
      ? "text-text-accent drop-shadow-accent-action"
      : state.offlineBusy
        ? "text-accent-action"
        : error
          ? "text-state-warning-text/90"
          : undefined,
  };
}

export function AlbumActionsView({
  state,
  actions,
  actionsRef,
  menu,
  supportAction,
  t,
}: {
  state: AlbumActionState;
  actions: AlbumActionHandlers;
  actionsRef?: RefObject<HTMLDivElement | null>;
  menu?: HeroActionMenu;
  supportAction?: ReactNode;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const secondaryActions: HeroSecondaryAction[] = [];
  if (!state.isPreRelease) {
    secondaryActions.push({
      key: "radio",
      label: t("radio.title"),
      icon: <Radio size={CRATE_ICON_SIZE.lg} />,
      onClick: actions.onAlbumRadio,
      ariaLabel: t("album.actions.radio"),
    });
  }
  if (state.canPersistAlbum) {
    secondaryActions.push(offlineAction(state, actions, t));
  }

  return (
    <div ref={actionsRef} data-testid="album-action-row">
      <HeroActionBar
        moreLabel={t("common.more")}
        primaryLabel={t("album.actions.primaryGroup")}
        secondaryLabel={t("album.actions.secondaryGroup")}
        primaryActions={[
          {
            key: "play",
            label: t("player.play"),
            icon: <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />,
            onClick: actions.onPlay,
            disabled: !state.playerTracksAvailable,
            ariaLabel: t("player.play"),
          },
          {
            key: "shuffle",
            label: t("player.shuffle"),
            icon: <Shuffle size={CRATE_ICON_SIZE.md} />,
            tone: "neutral",
            onClick: actions.onShuffle,
            disabled: !state.playerTracksAvailable,
            ariaLabel: t("player.shuffle"),
          },
        ]}
        secondaryActions={secondaryActions}
        secondaryExtra={
          <>
            {state.canSaveAlbum ? (
              <FollowHeartButton
                className={cn(
                  HERO_SECONDARY_ACTION_CLASS,
                  state.saved && HERO_SECONDARY_ACTION_ACTIVE_CLASS,
                )}
                onClick={actions.onToggleSaved}
                aria-label={
                  state.saved
                    ? t("album.actions.removeFromCollection")
                    : t("album.actions.addToCollection")
                }
                following={state.saved}
                iconSize={CRATE_ICON_SIZE.lg}
              >
                <span>{state.saved ? t("common.added") : t("common.add")}</span>
              </FollowHeartButton>
            ) : null}
            <button
              type="button"
              className={HERO_SECONDARY_ACTION_CLASS}
              onClick={actions.onShare}
              aria-label={t("common.share")}
            >
              <Share2 size={CRATE_ICON_SIZE.lg} />
              <span>{t("common.share")}</span>
            </button>
            {supportAction}
          </>
        }
        menu={menu}
      />
    </div>
  );
}
