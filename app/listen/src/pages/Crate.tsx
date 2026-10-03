import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  ArrowLeft,
  CRATE_ICON_SIZE,
  Disc3,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Radio,
  Trash2,
  Users,
} from "@crate/ui/icons";
import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { Button } from "@crate/ui/shadcn/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { action } from "@/components/actions/shared";
import { AlbumPrimaryActions } from "@/components/album/AlbumPrimaryActions";
import {
  PRIMARY_PLAY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/album/album-action-types";
import { CrateImage } from "@/components/artwork/CrateImage";
import { AlbumCard } from "@/components/cards/AlbumCard";
import {
  authenticatedCrateCoverUrl,
  type CrateCoverUrl,
} from "@/components/crates/CrateCoverFlow";
import { useCrateDownload } from "@/components/crates/crate-download";
import {
  buildCrateSharePayload,
  cratePagePath,
  crateRef,
  isShareableCrate,
  orderCrateAlbums,
  type NumberedCrateAlbum,
} from "@/components/crates/crate-model";
import {
  CrateActionRow,
  CrateHero,
  CrateSecondaryAction,
  CrateSecondaryActions,
  CrateShareAction,
} from "@/components/crates/CratePageHeader";
import { useCrateFollow } from "@/components/crates/use-crate-follow";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cacheSet } from "@/lib/cache";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { loginPathWithReturnTo } from "@/lib/auth-route-policy";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { publicCrateAlbumCoverUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { cn, shuffleArray } from "@/lib/utils";
import { toPlayableTrack } from "@/lib/playable-track";
import { startShapedRadio } from "@/lib/radio";
import { getOfflineActionLabelKey, isOfflineBusy } from "@/lib/offline";
import type {
  CrateAlbum,
  CrateDetail,
  CratePlaybackTrack,
} from "@/pages/crates-types";

const CrateEditor = lazy(() =>
  import("@/components/CrateEditor").then((module) => ({
    default: module.CrateEditor,
  })),
);

const CrateMembersModal = lazy(() =>
  import("@/components/crates/CrateMembersModal").then((module) => ({
    default: module.CrateMembersModal,
  })),
);

export function Crate() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading && !user) {
    return <CrateLoader label={t("crate.page.loading")} />;
  }

  return user ? <AuthenticatedCrate /> : <AnonymousCrate />;
}

function crateDetailUrl(ref: string) {
  return `/api/crates/${encodeURIComponent(ref)}`;
}

function useCrateDetail() {
  const { crateRef: requestedRef } = useParams<{ crateRef: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useApi<CrateDetail>(
    requestedRef ? crateDetailUrl(requestedRef) : null,
  );
  const canonicalRef = detail.data ? crateRef(detail.data) : null;

  useEffect(() => {
    if (!detail.data || !canonicalRef || canonicalRef === requestedRef) return;
    cacheSet(crateDetailUrl(canonicalRef), detail.data);
    navigate(
      `${cratePagePath(detail.data)}${location.search}${location.hash}`,
      { replace: true },
    );
  }, [
    canonicalRef,
    detail.data,
    location.hash,
    location.search,
    navigate,
    requestedRef,
  ]);

  const albums = useMemo(
    () =>
      detail.data
        ? orderCrateAlbums(
            detail.data.albums,
            detail.data.is_ordered,
            detail.data.sort_direction,
          )
        : [],
    [detail.data],
  );
  return { ...detail, albums };
}

function shareCrate(crate: CrateDetail, albums: NumberedCrateAlbum[]) {
  if (!isShareableCrate(crate)) return;
  openShareSheet(buildCrateSharePayload(crate, albums));
}

function AnonymousCrate() {
  const { t } = useTranslation();
  const location = useLocation();
  const { data, loading, albums } = useCrateDetail();
  const crateId = data?.id ?? null;
  const coverUrl = useCallback<CrateCoverUrl>(
    (album, size) =>
      crateId && album.has_cover
        ? publicCrateAlbumCoverUrl(crateId, album.global_album_uid, size)
        : null,
    [crateId],
  );

  if (loading && !data) {
    return <CrateLoader label={t("crate.page.loading")} />;
  }
  if (!data) {
    return (
      <CrateUnavailable
        showBackLink={false}
        loginPath={loginPathWithReturnTo(location.pathname)}
      />
    );
  }

  const loginPath = loginPathWithReturnTo(cratePagePath(data));

  return (
    <div data-testid="crate-shell" className="-mx-4 -mt-6 pb-12 sm:-mx-6">
      <CrateHero
        crate={data}
        albums={albums}
        coverUrl={coverUrl}
        followerCount={data.follower_count ?? 0}
        className="pt-6"
      />
      <CrateActionRow
        primary={
          <div className="grid grid-cols-1 gap-3 md:flex md:shrink-0 md:items-center">
            <Link to={loginPath} className={PRIMARY_PLAY_ACTION_CLASS}>
              <Play size={17} fill="currentColor" />
              <span>{t("crate.page.signInToListen")}</span>
            </Link>
          </div>
        }
        secondary={
          <CrateSecondaryActions>
            <CrateShareAction
              crate={data}
              onShare={() => shareCrate(data, albums)}
            />
          </CrateSecondaryActions>
        }
        footer={
          <p className="text-sm text-text-muted">
            {t("crate.page.signInHint")}
          </p>
        }
      />
      <CrateAlbumList albums={albums} coverUrl={coverUrl} linkAlbums={false} />
    </div>
  );
}

function AuthenticatedCrate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading, refetch, albums } = useCrateDetail();
  const crateId = data?.id ?? null;
  const {
    supported: offlineSupported,
    getCrateState,
    toggleCrateOffline,
  } = useOffline();
  const { data: playbackData, loading: playbackLoading } = useApi<
    CratePlaybackTrack[]
  >(crateId ? `/api/crates/${encodeURIComponent(crateId)}/playback` : null);
  const { playAll, setRepeatMode } = usePlayerActions();
  const [editing, setEditing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const primaryActionsRef = useRef<HTMLDivElement>(null);
  const downloadCrate = useCrateDownload();
  const canEdit = data?.access === "owner" || data?.access === "collaborator";
  const canManageMembers =
    data?.access === "owner" || data?.access === "collaborator";
  const canFollow = data?.visibility === "public" && data?.access === "public";
  const offlineState = data ? getCrateState(data.id) : "idle";
  const crateFollow = useCrateFollow({
    crateId: data?.id ?? null,
    initialFollowed: data?.is_followed ?? false,
    initialFollowerCount: data?.follower_count ?? 0,
    enabled: canFollow,
  });
  const playerTracks = useMemo<Track[]>(
    () =>
      (playbackData ?? []).map((track) =>
        toPlayableTrack(
          {
            id: track.local_track_id ?? track.global_track_uid,
            globalTrackUid: track.global_track_uid,
            globalAlbumUid: track.global_album_uid,
            globalArtistUid: track.global_artist_uid,
            entity_uid: track.local_track_entity_uid,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            libraryTrackId: track.local_track_id,
          },
          {
            cover: albumCoverApiUrl(
              {
                globalAlbumUid: track.global_album_uid,
                albumName: track.album,
                artistName: track.artist,
              },
              { size: 512 },
            ),
          },
        ),
      ),
    [playbackData],
  );
  const canPlay = !playbackLoading && playerTracks.length > 0;
  const removeAlbum = useCallback(
    async (album: CrateAlbum) => {
      if (!crateId) return;
      try {
        await api(
          `/api/crates/${crateId}/albums/${encodeURIComponent(
            album.global_album_uid,
          )}`,
          "DELETE",
        );
        refetch();
      } catch {
        toast.error(t("library.crates.albumRemoveFailed"));
      }
    },
    [crateId, refetch, t],
  );

  function startCratePlayback(tracks: Track[]) {
    if (!data || tracks.length === 0) return;
    setRepeatMode(data.loop_enabled ? "all" : "off");
    playAll(tracks, 0, {
      type: "crate",
      name: data.name,
      id: data.id,
      href: cratePagePath(data),
    });
  }

  async function startCrateRadio() {
    if (!data) return;
    try {
      const radio = await startShapedRadio("seeded", "crate", data.id);
      if (!radio?.tracks.length) {
        toast.info(t("actions.crate.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("actions.crate.toasts.radioFailed"));
    }
  }

  async function toggleOffline() {
    if (!data) return;
    try {
      const result = await toggleCrateOffline({
        crateId: data.id,
        title: data.name,
      });
      toast.success(
        result === "removed"
          ? t("actions.offline.toasts.removed")
          : t("actions.crate.toasts.offlineReady"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("actions.offline.toasts.updateFailed"),
      );
    }
  }

  if (loading && !data) {
    return <CrateLoader label={t("crate.page.loading")} />;
  }

  if (!data) return <CrateUnavailable showBackLink />;

  const hasAlbums = albums.length > 0;

  return (
    <div
      data-testid="crate-shell"
      className="-mx-4 -mt-4 pb-12 sm:-mx-6 sm:-mt-6"
    >
      <CrateHero
        crate={data}
        albums={albums}
        coverUrl={authenticatedCrateCoverUrl}
        followerCount={crateFollow.followerCount}
        className="pt-[var(--listen-mobile-page-top)] sm:pt-20"
      />
      <CrateActionRow
        primary={
          <AlbumPrimaryActions
            groupLabel={t("crate.page.primaryActions")}
            playerTracksAvailable={canPlay}
            primaryRef={primaryActionsRef}
            onPlay={() => startCratePlayback(playerTracks)}
            onShuffle={() => startCratePlayback(shuffleArray(playerTracks))}
            t={t}
          />
        }
        secondary={
          <CratePageActions
            crate={data}
            canPlay={canPlay}
            canEdit={Boolean(canEdit)}
            canManageMembers={canManageMembers}
            canFollow={canFollow}
            offlineSupported={offlineSupported && hasAlbums}
            offlineBusy={isOfflineBusy(offlineState)}
            offlineLabel={t(getOfflineActionLabelKey(offlineState))}
            offlineActive={offlineState === "ready"}
            followed={crateFollow.followed}
            followPending={crateFollow.pending}
            onRadio={() => void startCrateRadio()}
            onOffline={() => void toggleOffline()}
            onEdit={() => setEditing(true)}
            onMembers={() => setMembersOpen(true)}
            onFollow={() => void crateFollow.toggle()}
            onShare={() => shareCrate(data, albums)}
            onDownload={hasAlbums ? () => void downloadCrate(data) : undefined}
          />
        }
      />

      {editing && canEdit ? (
        <Suspense fallback={null}>
          <CrateEditor
            crateId={data.id}
            onBack={() => {
              setEditing(false);
              refetch();
            }}
            onDeleted={() =>
              navigate("/collection?tab=crates", { replace: true })
            }
          />
        </Suspense>
      ) : null}

      {membersOpen && canManageMembers ? (
        <Suspense fallback={null}>
          <CrateMembersModal
            crate={data}
            open
            onClose={() => setMembersOpen(false)}
            onCrateChange={refetch}
            onLeft={() => {
              setMembersOpen(false);
              navigate("/collection?tab=crates", { replace: true });
            }}
          />
        </Suspense>
      ) : null}

      <CrateAlbumList
        albums={albums}
        coverUrl={authenticatedCrateCoverUrl}
        linkAlbums
        onRemoveAlbum={canEdit ? removeAlbum : undefined}
      />
    </div>
  );
}

function CrateUnavailable({
  showBackLink,
  loginPath,
}: {
  showBackLink: boolean;
  loginPath?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-16 text-center">
      <Disc3 size={28} className="text-accent-action" />
      <p className="text-lg font-semibold text-text-primary">
        {t("crate.page.notFound")}
      </p>
      {showBackLink ? (
        <Link
          to="/collection?tab=crates"
          className="inline-flex items-center gap-2 text-sm text-accent-action hover:underline"
        >
          <ArrowLeft size={15} />
          {t("crate.page.backToCollection")}
        </Link>
      ) : null}
      {loginPath ? (
        <Button asChild size="sm" variant="outline">
          <Link to={loginPath}>{t("auth.login")}</Link>
        </Button>
      ) : null}
    </div>
  );
}

const CrateAlbumRow = memo(function CrateAlbumRow({
  album,
  coverUrl,
  onRemoveAlbum,
}: {
  album: NumberedCrateAlbum;
  coverUrl: CrateCoverUrl;
  onRemoveAlbum?: (album: CrateAlbum) => void;
}) {
  const { t } = useTranslation();
  const extraActions = useMemo<ItemActionMenuEntry[] | undefined>(
    () =>
      onRemoveAlbum
        ? [
            action({
              key: "crate-remove-album",
              label: t("crate.page.removeFromCrate"),
              icon: Trash2,
              danger: true,
              onSelect: () => onRemoveAlbum(album),
            }),
          ]
        : undefined,
    [album, onRemoveAlbum, t],
  );

  return (
    <AlbumCard
      variant="row"
      rank={album.displayNumber}
      artist={album.artist_name}
      album={album.name}
      globalAlbumUid={album.global_album_uid}
      year={album.year ?? undefined}
      cover={coverUrl(album, 192) ?? undefined}
      extraActions={extraActions}
    />
  );
});

function CrateAlbumPreviewRow({
  album,
  coverUrl,
}: {
  album: NumberedCrateAlbum;
  coverUrl: CrateCoverUrl;
}) {
  const albumCover = coverUrl(album, 192);
  return (
    <div className="flex items-center gap-[var(--content-row-gap)] px-3 py-[var(--content-row-padding-y)]">
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-text-muted">
        {album.displayNumber}
      </span>
      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-text-primary/5">
        {albumCover ? (
          <CrateImage
            src={albumCover}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-text-primary/35">
            <Disc3 size={CRATE_ICON_SIZE.md} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">
          {album.name}
        </p>
        <p className="truncate text-xs text-text-muted">
          {album.year ? `${album.year} · ` : ""}
          {album.artist_name}
        </p>
      </div>
    </div>
  );
}

function CrateAlbumList({
  albums,
  coverUrl,
  linkAlbums,
  onRemoveAlbum,
}: {
  albums: NumberedCrateAlbum[];
  coverUrl: CrateCoverUrl;
  linkAlbums: boolean;
  onRemoveAlbum?: (album: CrateAlbum) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-[1480px] space-y-4 px-4 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-text-primary">
          {t("crate.page.albums")}
        </h2>
        <span className="text-sm text-text-muted">
          {t("common.albumCountLabel", { count: albums.length })}
        </span>
      </div>
      {albums.length > 0 ? (
        <ol className="space-y-1">
          {albums.map((album) => (
            <li key={album.global_album_uid}>
              {linkAlbums ? (
                <CrateAlbumRow
                  album={album}
                  coverUrl={coverUrl}
                  onRemoveAlbum={onRemoveAlbum}
                />
              ) : (
                <CrateAlbumPreviewRow album={album} coverUrl={coverUrl} />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl border border-dashed border-border-quiet px-5 py-12 text-center text-sm text-text-muted">
          {t("crate.page.noAlbums")}
        </div>
      )}
    </section>
  );
}

function CratePageActions({
  crate,
  canPlay,
  canEdit,
  canManageMembers,
  canFollow,
  offlineSupported,
  offlineBusy,
  offlineLabel,
  offlineActive,
  followed,
  followPending,
  onRadio,
  onOffline,
  onEdit,
  onMembers,
  onFollow,
  onShare,
  onDownload,
}: {
  crate: CrateDetail;
  canPlay: boolean;
  canEdit: boolean;
  canManageMembers: boolean;
  canFollow: boolean;
  offlineSupported: boolean;
  offlineBusy: boolean;
  offlineLabel: string;
  offlineActive: boolean;
  followed: boolean;
  followPending: boolean;
  onRadio: () => void;
  onOffline: () => void;
  onEdit: () => void;
  onMembers: () => void;
  onFollow: () => void;
  onShare: () => void;
  onDownload?: () => void;
}) {
  const { t } = useTranslation();
  const entries = useMemo<ItemActionMenuEntry[]>(
    () =>
      onDownload
        ? [
            action({
              key: "download",
              label: t("actions.crate.downloadZip"),
              icon: Download,
              onSelect: onDownload,
            }),
          ]
        : [],
    [onDownload, t],
  );
  const actionMenu = useItemActionMenu(entries);
  const followLabel = followed ? t("common.following") : t("common.follow");

  return (
    <CrateSecondaryActions>
      {canPlay ? (
        <CrateSecondaryAction
          icon={<Radio size={CRATE_ICON_SIZE.lg} />}
          label={t("crate.page.radio")}
          aria-label={t("actions.crate.radio")}
          title={t("actions.crate.radio")}
          onClick={onRadio}
        />
      ) : null}
      {offlineSupported ? (
        <CrateSecondaryAction
          icon={
            offlineBusy ? (
              <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
            ) : offlineActive ? (
              <ArrowDownToLineBold size={CRATE_ICON_SIZE.lg} />
            ) : (
              <ArrowDownToLine size={CRATE_ICON_SIZE.lg} />
            )
          }
          label={t("common.offline")}
          aria-label={offlineLabel}
          title={offlineLabel}
          disabled={offlineBusy}
          className={
            offlineActive
              ? "text-text-accent drop-shadow-accent-action"
              : undefined
          }
          onClick={onOffline}
        />
      ) : null}
      {canFollow ? (
        <FollowHeartButton
          className={cn(
            SECONDARY_ACTION_CLASS,
            "min-w-0 px-0 md:px-1.5",
            followed
              ? "text-accent-action drop-shadow-accent-action"
              : "text-text-primary/62",
          )}
          following={followed}
          iconSize={CRATE_ICON_SIZE.lg}
          aria-label={followLabel}
          title={followLabel}
          disabled={followPending}
          onClick={onFollow}
        >
          <span>{followLabel}</span>
        </FollowHeartButton>
      ) : null}
      {canManageMembers ? (
        <CrateSecondaryAction
          icon={<Users size={CRATE_ICON_SIZE.lg} />}
          label={t("crate.page.members")}
          aria-label={t("library.crates.collaborators")}
          title={t("library.crates.collaborators")}
          onClick={onMembers}
        />
      ) : null}
      {canEdit ? (
        <CrateSecondaryAction
          icon={<Pencil size={CRATE_ICON_SIZE.lg} />}
          label={t("common.edit")}
          aria-label={t("crate.page.edit")}
          title={t("crate.page.edit")}
          onClick={onEdit}
        />
      ) : null}
      <CrateShareAction crate={crate} onShare={onShare} />
      {actionMenu.hasActions ? (
        <>
          <CrateSecondaryAction
            buttonRef={actionMenu.triggerRef}
            icon={<MoreHorizontal size={CRATE_ICON_SIZE.lg} />}
            label={t("common.more")}
            aria-label={t("common.more")}
            onClick={actionMenu.openFromTrigger}
          />
          <ItemActionMenu
            actions={entries}
            open={actionMenu.open}
            position={actionMenu.position}
            menuRef={actionMenu.menuRef}
            onClose={actionMenu.close}
          />
        </>
      ) : null}
    </CrateSecondaryActions>
  );
}
