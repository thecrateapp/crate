import type { RefObject } from "react";

import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  CRATE_ICON_SIZE,
  Disc,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import {
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
  HERO_SECONDARY_ACTION_CLASS,
  type HeroSecondaryAction,
} from "@crate/ui/domain/hero";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import type {
  AlbumActionData,
  AlbumActionHandlers,
  AlbumActionState,
} from "@/components/album/album-action-types";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { ListenHeroActionBar } from "@/components/hero/ListenHeroActionBar";
import { cn } from "@/lib/utils";

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

export function AlbumActions({
  data,
  coverUrl,
  displayName,
  state,
  menuItems,
  actionsRef,
  actions,
  t,
}: Pick<AlbumActionData, "data" | "coverUrl" | "displayName"> & {
  state: AlbumActionState;
  menuItems: ContextMenuEntry[];
  actionsRef: RefObject<HTMLDivElement | null>;
  actions: AlbumActionHandlers;
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
      <ListenHeroActionBar
        primaryLabel={t("album.actions.primaryGroup")}
        secondaryLabel={t("album.actions.secondaryGroup")}
        primaryActions={[
          {
            key: "play",
            label: t("player.play"),
            icon: <Play size={17} fill="currentColor" />,
            onClick: actions.onPlay,
            disabled: !state.playerTracksAvailable,
            ariaLabel: t("player.play"),
          },
          {
            key: "shuffle",
            label: t("player.shuffle"),
            icon: <Shuffle size={17} />,
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
            <BandcampSupportButton
              entityType="album"
              entityUid={data.entity_uid}
              fallbackArtistEntityUid={data.artist_entity_uid}
              presentation="secondary-action"
            />
          </>
        }
        menu={{
          actions: menuItems,
          header: {
            type: "media",
            title: displayName,
            subtitle: data.artist,
            imageUrl: data.has_cover || coverUrl ? coverUrl : undefined,
            imageAlt: displayName,
            imageShape: "square",
            fallbackIcon: Disc,
          },
        }}
      />
    </div>
  );
}
