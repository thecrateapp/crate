import { useGenreTileArtwork } from "./use-genre-tile-artwork";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildGenreActions,
  shareGenre,
  startGenreRadio,
} from "@/components/actions/genre-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { usePlayerActions } from "@/contexts/PlayerContext";

import { GenreTileView, type GenreTileVariant } from "./GenreTileView";
export type { GenreTileVariant } from "./GenreTileView";

interface GenreTileProps {
  variant: GenreTileVariant;
  slug: string;
  name: string;
  kicker: string;
  detail?: string | null;
  imageCandidates: string[];
  placeholderIndex?: number;
  onOpen: () => void;
}

export const GenreTile = memo(function GenreTile({
  variant,
  slug,
  name,
  kicker,
  detail,
  imageCandidates,
  onOpen,
}: GenreTileProps) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const { url: coverUrl, onError } = useGenreTileArtwork(imageCandidates);
  const room = variant === "room";

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  const getActions = useCallback(
    () =>
      buildGenreActions(
        {
          genre: { slug, name, imageUrl: coverUrl },
          onOpen: () => onOpenRef.current(),
          onStartRadio: () => startGenreRadio(slug, playAll, t),
          onShare: () => shareGenre({ slug, name, imageUrl: coverUrl }, t),
        },
        t,
      ),
    [coverUrl, name, playAll, slug, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: name,
      subtitle: t("genre.kind"),
      imageUrl: coverUrl,
      imageAlt: name,
      imageShape: "square",
      fallbackIcon: Tag,
    }),
    [coverUrl, name, t],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });

  return (
    <GenreTileView
      variant={variant}
      name={name}
      kicker={kicker}
      detail={detail}
      onOpen={onOpen}
      targetProps={targetProps}
      renderImage={
        coverUrl
          ? (className) => (
              <CrateImage
                src={coverUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                loading={room ? "lazy" : "eager"}
                onError={onError}
                className={className}
              />
            )
          : undefined
      }
      actions={
        <ItemActionMenuButton
          buttonRef={controller.triggerRef}
          hasActions={controller.hasActions}
          onClick={controller.openFromTrigger}
          expanded={controller.open}
          title={t("actions.menu.more")}
          className="absolute right-2 top-2 z-20 size-8 opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
        />
      }
      menu={menu}
    />
  );
});
