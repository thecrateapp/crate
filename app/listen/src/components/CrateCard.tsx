import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Lock,
  Play,
  Share2,
  Users,
} from "@crate/ui/icons";
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
import type { CrateShareAlbum } from "@/lib/social-share";
import type { CrateAlbum, CrateSummary } from "@/pages/crates-types";

interface CrateCardProps {
  crate: CrateSummary;
  onOpen: () => void;
  onEdit: () => void;
  onPlay?: (album: CrateAlbum) => void;
}

export function CrateCard({ crate, onOpen, onEdit, onPlay }: CrateCardProps) {
  const { t } = useTranslation();
  const albums = useMemo(() => {
    const source = crate.albums?.length
      ? crate.albums
      : crate.first_album
        ? [crate.first_album]
        : [];
    const direction =
      crate.is_ordered && crate.sort_direction === "desc" ? -1 : 1;
    return [...source].sort(
      (left, right) => direction * (left.position - right.position),
    );
  }, [crate.albums, crate.first_album, crate.is_ordered, crate.sort_direction]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex] ?? albums[0] ?? null;
  const cover = activeAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: activeAlbum.global_album_uid,
          albumName: activeAlbum.name,
          artistName: activeAlbum.artist_name,
        },
        { size: 256 },
      )
    : null;
  const shared = crate.access === "collaborator";
  const canEdit = crate.access === "owner" || crate.access === "collaborator";
  const moveActiveAlbum = (delta: number) => {
    if (albums.length === 0) return;
    setActiveIndex((index) => {
      const nextIndex = index + delta;
      if (crate.loop_enabled) {
        return (nextIndex + albums.length) % albums.length;
      }
      return Math.max(0, Math.min(albums.length - 1, nextIndex));
    });
  };
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
                crateAlbums: albums.map(
                  (album) =>
                    ({
                      imageUrl: album.has_cover
                        ? albumCoverApiUrl(
                            {
                              globalAlbumUid: album.global_album_uid,
                              albumName: album.name,
                              artistName: album.artist_name,
                            },
                            { size: 768 },
                          )
                        : null,
                      name: album.name,
                      artistName: album.artist_name,
                      position: album.position,
                    }) satisfies CrateShareAlbum,
                ),
                crateIsOrdered: crate.is_ordered,
                crateSortDirection: crate.sort_direction,
                crateTrackCount: crate.track_count,
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
      className="relative flex w-full flex-col rounded-xl border border-border-quiet bg-text-primary/[0.035] p-3 text-left transition-colors hover:bg-text-primary/[0.07]"
    >
      <div className="group min-w-0 flex-1 text-left">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-text-primary/5">
          <div
            key={activeAlbum?.global_album_uid ?? "empty"}
            className="size-full animate-hero-fade-in"
          >
            {cover ? (
              <CrateImage
                src={cover}
                alt={activeAlbum?.name ?? ""}
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-accent-action/70">
                <Disc3 size={28} />
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
          {albums.length > 1 ? (
            <>
              <button
                type="button"
                aria-label={t("library.crates.previousAlbum")}
                disabled={!crate.loop_enabled && activeIndex === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  moveActiveAlbum(-1);
                }}
                className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:bg-black/65 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                aria-label={t("library.crates.nextAlbum")}
                disabled={
                  !crate.loop_enabled && activeIndex === albums.length - 1
                }
                onClick={(event) => {
                  event.stopPropagation();
                  moveActiveAlbum(1);
                }}
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:bg-black/65 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </>
          ) : null}
          <span className="absolute bottom-3 left-3 right-3 truncate text-sm font-semibold text-white">
            {activeAlbum?.name ?? crate.name}
          </span>
          <button
            type="button"
            aria-label={t("library.crates.play", { name: crate.name })}
            onClick={(event) => {
              event.stopPropagation();
              if (activeAlbum) onPlay?.(activeAlbum);
            }}
            className="absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-lg transition-transform group-hover:scale-105"
          >
            <Play size={20} fill="currentColor" />
          </button>
        </div>
      </div>
      <div className="min-w-0 px-0.5 pb-1 pt-3">
        <button
          type="button"
          aria-label={t("library.crates.open", { name: crate.name })}
          onClick={onOpen}
          className="block max-w-full truncate text-left font-semibold text-text-primary"
        >
          {crate.name}
        </button>
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
            {crate.track_count > 0
              ? ` · ${t("common.trackCountLabel", {
                  count: crate.track_count,
                })}`
              : ""}
          </span>
        </div>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="absolute right-4 top-4 z-10 size-9 shrink-0"
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
