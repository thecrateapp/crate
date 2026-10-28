import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Disc3 } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { buildReleaseActions } from "@/components/actions/show-actions";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";

import { UpcomingEventArtwork } from "./UpcomingEventRowView";
import { UpcomingReleaseRowView } from "./UpcomingReleaseRowView";
import { buildUpcomingEventRowModel } from "./upcoming-event-row-model";
import type { UpcomingItem } from "./upcoming-model";

export const ReleaseRow = memo(function ReleaseRow({
  item,
}: {
  item: UpcomingItem;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const model = buildUpcomingEventRowModel(item);
  const { albumPath, artistPath } = model;

  const getActions = useCallback(
    () => buildReleaseActions({ albumPath, artistPath }, { t, navigate }),
    [albumPath, artistPath, navigate, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: item.title,
      subtitle: item.artist,
      imageUrl: model.coverUrl ?? null,
      imageAlt: item.title,
      imageShape: "square",
      fallbackIcon: Disc3,
    }),
    [item.artist, item.title, model.coverUrl],
  );
  const actionMenu = useListenEntityMenu(getActions, header);

  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });
  return (
    <UpcomingReleaseRowView
      item={item}
      albumPath={albumPath}
      artwork={
        <UpcomingEventArtwork
          kind="release"
          src={model.coverUrl}
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
      actionMenu={{
        triggerRef: controller.triggerRef,
        hasActions: controller.hasActions,
        open: controller.open,
        onOpen: controller.openFromTrigger,
      }}
      articleProps={targetProps}
      menu={menu}
    />
  );
});
