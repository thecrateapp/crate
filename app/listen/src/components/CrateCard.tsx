import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, Disc3, Lock, Play } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
  useItemActionTarget,
} from "@/components/actions/ItemActionMenu";
import { useCrateActionEntries } from "@/components/actions/crate-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  buildCrateSharePayload,
  crateOwnerName,
  cratePagePath,
  crateSummaryAlbums,
  isShareableCrate,
  orderCrateAlbums,
} from "@/components/crates/crate-model";
import { useCrateFollow } from "@/components/crates/use-crate-follow";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { openShareSheet } from "@/lib/social-share";
import { cn } from "@/lib/utils";
import type { CrateSummary } from "@/pages/crates-types";

interface CrateCardProps {
  crate: CrateSummary;
  onEdit?: () => void;
  onPlay?: () => void | Promise<void>;
  onShuffle?: () => void | Promise<void>;
  onStartRadio?: () => void | Promise<void>;
  onMakeAvailableOffline?: () => void | Promise<void>;
  onDownload?: () => void | Promise<void>;
  offlineActionLabel?: string;
  offlineActionDisabled?: boolean;
  offlineActionActive?: boolean;
  layout?: "rail" | "grid";
}

function crateAccessLabelKey(crate: CrateSummary) {
  if (crate.access === "collaborator") return "library.crates.sharedWithYou";
  return crate.visibility === "private"
    ? "library.crates.private"
    : "library.crates.public";
}

export function CrateCard({
  crate,
  onEdit,
  onPlay,
  onShuffle,
  onStartRadio,
  onMakeAvailableOffline,
  onDownload,
  offlineActionLabel,
  offlineActionDisabled,
  offlineActionActive,
  layout = "rail",
}: CrateCardProps) {
  const { t } = useTranslation();
  const albums = useMemo(
    () =>
      orderCrateAlbums(
        crateSummaryAlbums(crate),
        crate.is_ordered,
        crate.sort_direction,
      ),
    [crate],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex] ?? albums[0] ?? null;
  const canFollow = crate.access === "public" && crate.visibility === "public";
  const crateFollow = useCrateFollow({
    crateId: crate.id,
    initialFollowed: crate.is_followed ?? false,
    initialFollowerCount: crate.follower_count ?? 0,
    enabled: canFollow,
  });
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
  const hasAlbums = crate.album_count > 0;
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
  const onShare = () => {
    if (!isShareableCrate(crate)) return;
    openShareSheet(buildCrateSharePayload(crate, albums));
  };
  const actions = useCrateActionEntries({
    crate,
    onPlay: hasAlbums ? onPlay : undefined,
    onShuffle: hasAlbums ? onShuffle : undefined,
    onEdit,
    onStartRadio: hasAlbums ? onStartRadio : undefined,
    onMakeAvailableOffline: hasAlbums ? onMakeAvailableOffline : undefined,
    onDownload: hasAlbums ? onDownload : undefined,
    onShare,
    onToggleFollow: canFollow ? crateFollow.toggle : undefined,
    followed: crateFollow.followed,
    followPending: crateFollow.pending,
    offlineActionLabel,
    offlineActionDisabled,
    offlineActionActive,
  });
  const actionMenu = useItemActionMenu(actions);
  const actionTarget = useItemActionTarget(actionMenu);
  const ownerName = crateOwnerName(crate);

  return (
    <div
      data-testid="crate-card"
      className={cn(
        "item-action-target group relative flex flex-col rounded-xl border border-border-quiet bg-text-primary/[0.035] p-3 text-left transition-colors hover:bg-text-primary/[0.07]",
        layout === "rail" ? "w-[160px] shrink-0 snap-start" : "w-full min-w-0",
      )}
      {...actionTarget}
    >
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
        {crate.visibility === "private" ? (
          <div
            data-testid="crate-visibility"
            role="img"
            aria-label={t("library.crates.private")}
            className="pointer-events-none absolute left-2 top-2 z-10 flex items-center rounded-full border border-white/15 bg-black/45 p-2 text-white backdrop-blur-md"
          >
            <Lock size={12} aria-hidden="true" />
          </div>
        ) : null}
        {crate.is_ordered && activeAlbum ? (
          <span className="pointer-events-none absolute bottom-1 right-2 text-5xl font-black leading-none tracking-[-0.08em] text-white/25">
            <span className="sr-only">
              {t("stats.rank", { rank: activeAlbum.displayNumber })}
            </span>
            {String(activeAlbum.displayNumber).padStart(2, "0")}
          </span>
        ) : null}
        {albums.length > 1 ? (
          <>
            <button
              type="button"
              aria-label={t("library.crates.previousAlbum")}
              disabled={!crate.loop_enabled && activeIndex === 0}
              onClick={() => moveActiveAlbum(-1)}
              className="absolute left-2 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white opacity-0 transition hover:bg-black/65 focus-visible:opacity-100 disabled:opacity-0 group-hover:opacity-100 group-hover:disabled:opacity-30 pointer-coarse:hidden"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label={t("library.crates.nextAlbum")}
              disabled={
                !crate.loop_enabled && activeIndex === albums.length - 1
              }
              onClick={() => moveActiveAlbum(1)}
              className="absolute right-2 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white opacity-0 transition hover:bg-black/65 focus-visible:opacity-100 disabled:opacity-0 group-hover:opacity-100 group-hover:disabled:opacity-30 pointer-coarse:hidden"
            >
              <ChevronRight size={16} />
            </button>
          </>
        ) : null}
        {hasAlbums && onPlay ? (
          <button
            type="button"
            aria-label={t("library.crates.play", { name: crate.name })}
            onClick={() => void onPlay()}
            className="absolute bottom-2 left-2 z-10 flex size-11 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-lg transition-transform hover:scale-105"
          >
            <Play size={18} fill="currentColor" />
          </button>
        ) : null}
      </div>
      <div className="min-w-0 px-0.5 pb-1 pt-3">
        <Link
          to={cratePagePath(crate)}
          aria-label={t("library.crates.open", { name: crate.name })}
          className="block max-w-full truncate text-left font-semibold text-text-primary after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-action/60"
        >
          {crate.name}
        </Link>
        <div className="mt-1 truncate text-xs text-text-muted">
          {t("common.albumCountLabel", { count: crate.album_count })}
          {` · ${t("common.trackCountLabel", { count: crate.track_count })}`}
        </div>
        <div className="mt-0.5 truncate text-xs text-text-muted">
          {t(crateAccessLabelKey(crate))}
          {canFollow && ownerName ? ` · ${ownerName}` : ""}
        </div>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={(event) => {
          event.stopPropagation();
          actionMenu.openFromTrigger(event);
        }}
        expanded={actionMenu.open}
        title={t("actions.menu.more")}
        className="absolute right-4 top-4 z-10 size-9 shrink-0"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: crate.name,
          subtitle: ownerName ?? undefined,
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
