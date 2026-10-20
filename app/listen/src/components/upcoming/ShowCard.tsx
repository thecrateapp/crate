import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Calendar } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { UpcomingEventArtwork } from "./UpcomingEventRowView";
import { UpcomingShowCardView } from "./UpcomingShowCardView";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildShowActions,
  type ShowActionInput,
} from "@/components/actions/show-actions";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import type { UpcomingItem } from "./upcoming-model";
import { useUpcomingGenreProfile } from "./use-upcoming-genre-profile";
import { useUpcomingShowActions } from "./use-upcoming-show-actions";

export type ShowCardVariant = "row" | "preview" | "feature";

interface ShowCardProps {
  item: UpcomingItem;
  variant?: ShowCardVariant;
  expanded?: boolean;
  onToggle?: () => void;
  onAttendanceChange?: (attending: boolean) => void;
}

const noop = () => undefined;

export const ShowCard = memo(function ShowCard({
  item,
  variant = "row",
  expanded: expandedProp = false,
  onToggle = noop,
  onAttendanceChange,
}: ShowCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const collapsible = variant === "row";
  const expanded = collapsible ? expandedProp : true;
  const displayItem = useUpcomingGenreProfile(item, expanded);
  const {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  } = useUpcomingShowActions(item, onAttendanceChange);

  const latestActionInput = useRef<ShowActionInput>({
    item,
    attending,
    toggleAttendance,
    playProbableSetlist,
  });
  useEffect(() => {
    latestActionInput.current = {
      item,
      attending,
      toggleAttendance,
      playProbableSetlist,
    };
  });
  const getActions = useCallback(
    () => buildShowActions(latestActionInput.current, { t, navigate }),
    [navigate, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: item.artist,
      subtitle: item.title,
      detail: item.subtitle,
      imageUrl: resolveMaybeApiAssetUrl(item.cover_url),
      imageAlt: item.artist,
      imageShape: "square",
      fallbackIcon: Calendar,
    }),
    [item.artist, item.cover_url, item.subtitle, item.title],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });
  const actionMenuSlot = useMemo(
    () => ({
      triggerRef: controller.triggerRef,
      hasActions: controller.hasActions,
      open: controller.open,
      onOpen: controller.openFromTrigger,
    }),
    [
      controller.hasActions,
      controller.open,
      controller.openFromTrigger,
      controller.triggerRef,
    ],
  );

  const artistImageUrl =
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 320 },
    ) || resolveMaybeApiAssetUrl(item.cover_url);
  return (
    <UpcomingShowCardView
      item={displayItem}
      variant={variant}
      expanded={expanded}
      artistHref={artistPagePath({
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
      })}
      attending={attending}
      savingAttendance={savingAttendance}
      playingSetlist={playingSetlist}
      onToggleAttendance={toggleAttendance}
      onPlaySetlist={playProbableSetlist}
      onClose={onToggle}
      actionMenu={actionMenuSlot}
      articleProps={targetProps}
      menu={menu}
      artwork={
        <UpcomingEventArtwork
          kind="show"
          src={artistImageUrl}
          renderImage={({ src, alt, fallback }) => (
            <ArtworkSurface
              source={src}
              alt={alt}
              fallback={fallback}
              imageClassName="object-cover"
              imageProps={{ loading: "lazy" }}
              className="size-full"
            />
          )}
        />
      }
    />
  );
});
