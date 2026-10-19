import type { RefObject } from "react";
import { Disc } from "@crate/ui/icons";
import type { ContextMenuMediaImageProps } from "@crate/ui/domain/actions";
import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import type {
  AlbumActionData,
  AlbumActionHandlers,
  AlbumActionState,
} from "./album-action-types";
import { AlbumActionsView } from "./AlbumActionsView";
function renderMediaImage({ src, ...props }: ContextMenuMediaImageProps) {
  return <CrateImage {...props} source={src} />;
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
  return (
    <AlbumActionsView
      state={state}
      actions={actions}
      actionsRef={actionsRef}
      t={t}
      supportAction={
        <BandcampSupportButton
          entityType="album"
          entityUid={data.entity_uid}
          fallbackArtistEntityUid={data.artist_entity_uid}
          presentation="secondary-action"
        />
      }
      menu={{
        actions: menuItems,
        sheetLabel: t("actions.menu.sheetLabel"),
        surfaceClassName: "listen-glass-panel",
        renderMediaImage,
        onOpenChange: (open) => {
          if (!open) actions.onMenuClose();
        },
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
  );
}
