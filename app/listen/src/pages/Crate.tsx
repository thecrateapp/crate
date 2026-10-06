import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  CRATE_ICON_SIZE,
  Disc3,
  Loader2,
  Pencil,
  Play,
  Radio,
  Shuffle,
  Trash2,
  Users,
} from "@crate/ui/icons";
import type {
  ContextMenuHeader,
  ItemActionMenuEntry,
} from "@crate/ui/domain/actions";
import {
  HERO_PRIMARY_ACTION_CLASS,
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
  HERO_SECONDARY_ACTION_CLASS,
  type HeroSecondaryAction,
} from "@crate/ui/domain/hero";
import { EmptyState, ErrorState } from "@crate/ui/domain/states";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { Button } from "@crate/ui/shadcn/button";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { buildCrateMenuItems } from "@/components/actions/crate-actions";
import { action } from "@/components/actions/shared";
import { CrateImage } from "@/components/artwork/CrateImage";
import { useTransparentHeader } from "@/components/layout/transparent-header";
import { AlbumCard } from "@/components/cards/AlbumCard";
import {
  authenticatedCrateCoverUrl,
  type CrateCoverUrl,
} from "@/components/crates/CrateCoverFlow";
import { useCrateDownload } from "@/components/crates/crate-download";
import {
  buildCrateSharePayload,
  crateOwnerName,
  cratePagePath,
  crateRef,
  isShareableCrate,
  orderCrateAlbums,
  type NumberedCrateAlbum,
} from "@/components/crates/crate-model";
import {
  CRATE_SECONDARY_ACTION_CLASS,
  CrateHero,
  crateShareAction,
} from "@/components/crates/CratePageHeader";
import { ListenHeroActionBar } from "@/components/hero/ListenHeroActionBar";
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
  useTransparentHeader();
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
        contentClassName="pt-6"
        actions={
          <>
            <ListenHeroActionBar
              primaryLabel={t("crate.page.primaryActions")}
              secondaryLabel={t("crate.page.secondaryActions")}
              primaryExtra={
                <Link
                  to={loginPath}
                  className={cn(HERO_PRIMARY_ACTION_CLASS, "col-span-2")}
                >
                  <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
                  <span>{t("crate.page.signInToListen")}</span>
                </Link>
              }
              secondaryLayout="fill"
              secondaryActions={[
                crateShareAction(data, () => shareCrate(data, albums), t),
              ]}
            />
            <p className="mx-auto mt-3 w-full max-w-content text-sm text-text-muted">
              {t("crate.page.signInHint")}
            </p>
          </>
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
        notify.error(t("library.crates.albumRemoveFailed"));
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
        notify.info(t("actions.crate.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("actions.crate.toasts.radioFailed"));
    }
  }

  async function toggleOffline() {
    if (!data) return;
    try {
      const result = await toggleCrateOffline({
        crateId: data.id,
        title: data.name,
      });
      notify.success(
        result === "removed"
          ? t("actions.offline.toasts.removed")
          : t("actions.crate.toasts.offlineReady"),
      );
    } catch (error) {
      notify.error(
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
        contentClassName="pt-[var(--listen-mobile-page-top)] sm:pt-20"
        actions={
          <CratePageActions
            crate={data}
            albums={albums}
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
            onPlay={() => startCratePlayback(playerTracks)}
            onShuffle={() => startCratePlayback(shuffleArray(playerTracks))}
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
    <ErrorState
      kind="unavailable"
      icon={Disc3}
      title={t("crate.page.notFound")}
      backTo={showBackLink ? "/collection?tab=crates" : undefined}
      backLabel={t("crate.page.backToCollection")}
      action={
        loginPath ? (
          <Button asChild size="sm" variant="outline">
            <Link to={loginPath}>{t("auth.login")}</Link>
          </Button>
        ) : undefined
      }
      className="py-16"
    />
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
    <section className="mx-auto max-w-content space-y-4 px-4 sm:px-6">
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
        <EmptyState variant="dashed" message={t("crate.page.noAlbums")} />
      )}
    </section>
  );
}

function CratePageActions({
  crate,
  albums,
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
  onPlay,
  onShuffle,
  onRadio,
  onOffline,
  onEdit,
  onMembers,
  onFollow,
  onShare,
  onDownload,
}: {
  crate: CrateDetail;
  albums: NumberedCrateAlbum[];
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
  onPlay: () => void;
  onShuffle: () => void;
  onRadio: () => void;
  onOffline: () => void;
  onEdit: () => void;
  onMembers: () => void;
  onFollow: () => void;
  onShare: () => void;
  onDownload?: () => void;
}) {
  const { t } = useTranslation();
  const entries = buildCrateMenuItems(
    {
      crate,
      onPlay: canPlay ? onPlay : undefined,
      onShuffle: canPlay ? onShuffle : undefined,
      onEdit: canEdit ? onEdit : undefined,
      onManageMembers: canManageMembers ? onMembers : undefined,
      onStartRadio: canPlay ? onRadio : undefined,
      onMakeAvailableOffline: offlineSupported ? onOffline : undefined,
      onDownload,
      onShare,
      onToggleFollow: canFollow ? onFollow : undefined,
      followed,
      followPending,
      offlineActionLabel: offlineLabel,
      offlineActionDisabled: offlineBusy,
      offlineActionActive: offlineActive,
    },
    t,
  );
  const coverAlbum = albums[0];
  const menuHeader: ContextMenuHeader = {
    type: "media",
    title: crate.name,
    subtitle: crateOwnerName(crate) ?? undefined,
    detail: t("common.albumCountLabel", { count: albums.length }),
    imageUrl: coverAlbum
      ? authenticatedCrateCoverUrl(coverAlbum, 192) ?? undefined
      : undefined,
    imageAlt: crate.name,
    imageShape: "square",
    fallbackIcon: Disc3,
  };
  const followLabel = followed ? t("common.following") : t("common.follow");
  const secondaryActions: HeroSecondaryAction[] = [];
  if (canPlay) {
    secondaryActions.push({
      key: "radio",
      label: t("crate.page.radio"),
      icon: <Radio size={CRATE_ICON_SIZE.lg} />,
      ariaLabel: t("actions.crate.radio"),
      title: t("actions.crate.radio"),
      onClick: onRadio,
      className: CRATE_SECONDARY_ACTION_CLASS,
    });
  }
  if (offlineSupported) {
    secondaryActions.push({
      key: "offline",
      label: t("common.offline"),
      icon: offlineBusy ? (
        <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
      ) : offlineActive ? (
        <ArrowDownToLineBold size={CRATE_ICON_SIZE.lg} />
      ) : (
        <ArrowDownToLine size={CRATE_ICON_SIZE.lg} />
      ),
      ariaLabel: offlineLabel,
      title: offlineLabel,
      disabled: offlineBusy,
      onClick: onOffline,
      className: cn(
        CRATE_SECONDARY_ACTION_CLASS,
        offlineActive && "text-text-accent drop-shadow-accent-action",
      ),
    });
  }
  if (canManageMembers) {
    secondaryActions.push({
      key: "members",
      label: t("crate.page.members"),
      icon: <Users size={CRATE_ICON_SIZE.lg} />,
      ariaLabel: t("library.crates.collaborators"),
      title: t("library.crates.collaborators"),
      onClick: onMembers,
      className: CRATE_SECONDARY_ACTION_CLASS,
    });
  }
  if (canEdit) {
    secondaryActions.push({
      key: "edit",
      label: t("common.edit"),
      icon: <Pencil size={CRATE_ICON_SIZE.lg} />,
      ariaLabel: t("crate.page.edit"),
      title: t("crate.page.edit"),
      onClick: onEdit,
      className: CRATE_SECONDARY_ACTION_CLASS,
    });
  }
  secondaryActions.push(crateShareAction(crate, onShare, t));

  return (
    <ListenHeroActionBar
      primaryLabel={t("crate.page.primaryActions")}
      secondaryLabel={t("crate.page.secondaryActions")}
      primaryActions={[
        {
          key: "play",
          label: t("actions.crate.play"),
          icon: <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />,
          onClick: onPlay,
          disabled: !canPlay,
          ariaLabel: t("actions.crate.play"),
        },
        {
          key: "shuffle",
          label: t("player.shuffle"),
          icon: <Shuffle size={CRATE_ICON_SIZE.md} />,
          tone: "neutral",
          onClick: onShuffle,
          disabled: !canPlay,
          ariaLabel: t("player.shuffle"),
        },
      ]}
      secondaryLayout="fill"
      secondaryLeading={
        canFollow ? (
          <FollowHeartButton
            className={cn(
              HERO_SECONDARY_ACTION_CLASS,
              CRATE_SECONDARY_ACTION_CLASS,
              followed && HERO_SECONDARY_ACTION_ACTIVE_CLASS,
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
        ) : null
      }
      secondaryActions={secondaryActions}
      menu={
        entries.length > 0
          ? { actions: entries, header: menuHeader }
          : undefined
      }
    />
  );
}
