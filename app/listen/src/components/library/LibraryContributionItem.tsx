import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EntityMenuRenderer } from "@crate/ui/domain/entity";
import {
  AlbumCardArtwork,
  AlbumCardArtworkBadges,
  AlbumCardMenu,
  AlbumCardSubtitle,
  useAlbumCardModel,
  useAlbumCardPlayback,
} from "@/components/cards/AlbumCardParts";
import { ItemActionMenu } from "@/components/actions/ItemActionMenu";
import { buildContributionActions } from "@/components/actions/contribution-actions";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { ContributionArtwork } from "./ContributionArtwork";
import { LibraryContributionCard } from "./LibraryContributionCard";
import { albumPagePath } from "@/lib/library-routes";
import { contributionSourceLabel } from "@/lib/contributions";
import type { LibraryContribution } from "@/pages/library-model";

/** Album presentation and playback stay canonical; contribution actions retain their own confirmation. */
export function LibraryContributionItem({
  contribution,
  onExport,
  onWithdraw,
}: {
  contribution: LibraryContribution;
  onExport: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const available = Boolean(contribution.album_id);
  const albumId = contribution.album_id ?? undefined;
  const model = useAlbumCardModel({
    artist: contribution.artist_name,
    album: contribution.album_name,
    albumId,
    albumEntityUid: contribution.album_entity_uid ?? undefined,
    albumSlug: contribution.album_slug ?? undefined,
    layout: "grid",
    isPreRelease: false,
  });
  const { playing, handlePlayOverlay } = useAlbumCardPlayback({
    albumRouteInput: model.albumRouteInput,
    album: contribution.album_name,
    albumId,
    artist: contribution.artist_name,
    coverUrl: model.coverUrl,
    playAll,
  });
  const actions = useMemo(
    () =>
      buildContributionActions(
        { canExport: available, onExport, onWithdraw },
        t,
      ),
    [available, onExport, onWithdraw, t],
  );
  const renderMenu = useCallback<EntityMenuRenderer>(
    (controller) =>
      available ? (
        <AlbumCardMenu
          actionMenu={controller}
          input={model.menuInput}
          extraActions={actions}
        />
      ) : (
        <ItemActionMenu
          actions={actions}
          header={{
            type: "media",
            title: contribution.album_name,
            subtitle: contribution.artist_name,
          }}
          open={controller.open}
          position={controller.position}
          menuRef={controller.menuRef}
          onClose={controller.close}
        />
      ),
    [
      available,
      model.menuInput,
      actions,
      contribution.album_name,
      contribution.artist_name,
    ],
  );
  return (
    <LibraryContributionCard
      title={contribution.album_name}
      artist={
        available ? (
          <AlbumCardSubtitle
            artist={contribution.artist_name}
            isPreRelease={false}
            offlineMeta={model.offlineMeta}
            offlineState={model.offlineState}
          />
        ) : (
          contribution.artist_name
        )
      }
      sourceLabel={contributionSourceLabel(contribution.source)}
      artwork={
        available ? (
          <AlbumCardArtwork
            coverArtwork={model.coverArtwork}
            coverSizes={model.coverSizes}
            album={contribution.album_name}
            className="size-full"
          />
        ) : (
          <ContributionArtwork contribution={contribution} layout="grid" />
        )
      }
      artworkOverlay={
        available ? (
          <AlbumCardArtworkBadges
            offlineState={model.offlineState}
            isPreRelease={false}
          />
        ) : undefined
      }
      overlay={
        available
          ? {
              onPlay: handlePlayOverlay,
              loading: playing,
              playLabel: t("common.playItem", {
                name: contribution.album_name,
              }),
              follow: {
                following: model.saved,
                label: model.savedLabel,
                onToggle: model.handleToggleSaved,
              },
            }
          : undefined
      }
      href={available ? albumPagePath(model.albumRouteInput) : undefined}
      renderMenu={renderMenu}
    />
  );
}
