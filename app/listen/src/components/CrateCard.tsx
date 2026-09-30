import { Disc3, Lock, Share2, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import type { CrateSummary } from "@/pages/crates-types";

interface CrateCardProps {
  crate: CrateSummary;
  onOpen: () => void;
  onEdit: () => void;
}

export function CrateCard({ crate, onOpen, onEdit }: CrateCardProps) {
  const { t } = useTranslation();
  const firstAlbum = crate.first_album;
  const cover = firstAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: firstAlbum.global_album_uid,
          albumName: firstAlbum.name,
          artistName: firstAlbum.artist_name,
        },
        { size: 256 },
      )
    : null;
  const shared = crate.access === "collaborator";
  const canEdit = crate.access === "owner" || crate.access === "collaborator";
  const actions = [
    {
      key: "open",
      label: t("library.crates.open", { name: crate.name }),
      icon: Disc3,
      onSelect: onOpen,
    },
    ...(crate.visibility === "public"
      ? [
          {
            key: "share",
            label: t("crate.page.share"),
            icon: Share2,
            onSelect: () =>
              openShareSheet({
                kind: "crate",
                title: crate.name,
                subtitle: crate.owner_name ?? crate.owner_username ?? undefined,
                imageUrl: cover ?? undefined,
                url: publicShareUrl(`/share/crate/${crate.id}`),
              }),
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            key: "edit",
            label: t("crate.page.edit"),
            onSelect: onEdit,
          },
        ]
      : []),
  ];
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      onContextMenu={actionMenu.handleContextMenu}
      className="flex w-full items-center gap-2 rounded-xl border border-border-quiet bg-text-primary/[0.035] p-3 text-left transition-colors hover:bg-text-primary/[0.07]"
    >
      <button
        type="button"
        aria-label={t("library.crates.open", { name: crate.name })}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-text-primary/5">
          {cover ? (
            <CrateImage
              src={cover}
              alt={firstAlbum?.name ?? ""}
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-accent-action/70">
              <Disc3 size={28} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text-primary">
            {crate.name}
          </div>
          {crate.description && (
            <p className="mt-0.5 line-clamp-1 text-sm text-text-muted">
              {crate.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            {shared ? <Users size={13} /> : <Lock size={13} />}
            <span>
              {shared
                ? t("library.crates.sharedWithYou")
                : crate.visibility === "public"
                  ? t("library.crates.public")
                  : t("library.crates.private")}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t("common.albumCountLabel", { count: crate.album_count })}
            </span>
          </div>
        </div>
      </button>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="size-9 shrink-0"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: crate.name,
          subtitle: crate.owner_name ?? crate.owner_username ?? undefined,
          detail: t("common.albumCountLabel", { count: crate.album_count }),
          imageUrl: cover ?? undefined,
          imageAlt: crate.name,
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
