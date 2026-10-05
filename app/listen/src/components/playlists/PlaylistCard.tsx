import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  Play,
  Shuffle,
  Sparkles,
  type LucideIcon,
} from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import {
  EntityCard,
  EntityRow,
  type EntityCardOverlay,
} from "@crate/ui/domain/entity";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { action } from "@/components/actions/shared";
import { usePlaylistActionMenu } from "@/components/actions/playlist-actions";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import {
  EDITORIAL_PLAYLIST_KICKER_KEYS,
  EditorialPlaylistArtwork,
  editorialPlaylistLabel,
} from "@/components/playlists/EditorialPlaylistArtwork";
import { usePlaylistListRowPlayback } from "@/components/playlists/use-playlist-list-row-playback";
import { useOffline } from "@/contexts/OfflineContext";
import {
  getOfflineStateLabel,
  isOfflineBusy,
  type OfflineItemRecord,
  type OfflineItemState,
} from "@/lib/offline";
import { cn } from "@/lib/utils";

type Handler = () => Promise<void> | void;
type TFn = ReturnType<typeof useTranslation>["t"];

export type PlaylistCardVariant = "tile" | "featured" | "row";

export interface PlaylistCardExtraAction {
  key: string;
  icon: LucideIcon;
  title: string;
  onClick: Handler;
  loading?: boolean;
  tone?: "default" | "danger" | "primary";
}

export interface PlaylistCardProps {
  variant?: PlaylistCardVariant;
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta?: string;
  badge?: string;
  systemPlaylist?: boolean;
  crateManaged?: boolean;
  isFollowed?: boolean;
  href?: string;
  layout?: "rail" | "grid";
  renderArtwork?: (className: string) => ReactNode;
  summary?: string;
  artworkOnly?: boolean;
  trackCount?: number;
  detailEndpoint?: string;
  extraActions?: PlaylistCardExtraAction[];
  className?: string;
  onClick?: () => void;
  onPlay?: Handler;
  onShuffle?: Handler;
  onStartRadio?: Handler;
  onToggleFollow?: Handler;
}

export function getPlaylistOfflineMeta(
  state: OfflineItemState,
  record:
    | Pick<OfflineItemRecord, "trackCount" | "readyTrackCount">
    | null
    | undefined,
  t: TFn,
): string | null {
  if (state === "ready") {
    return record?.trackCount
      ? t("common.offlineCount", { count: record.trackCount })
      : getOfflineStateLabel(state);
  }

  if (isOfflineBusy(state) && record?.trackCount) {
    return t("common.offlineProgress", {
      ready: Math.min(record.readyTrackCount || 0, record.trackCount),
      total: record.trackCount,
    });
  }

  return getOfflineStateLabel(state);
}

function offlineMetaClass(state: OfflineItemState): string | undefined {
  if (state === "ready") return "text-text-accent/90";
  if (isOfflineBusy(state)) return "text-accent-action";
  if (state === "error") return "text-state-warning-text/90";
  return undefined;
}

function tileSurfaceClass(state: OfflineItemState): string | undefined {
  if (state === "ready") return "bg-accent-action/[0.04]";
  if (isOfflineBusy(state)) return "bg-accent-action/[0.05]";
  if (state === "error") return "bg-state-warning/[0.05]";
  return undefined;
}

function rowSurfaceClass(state: OfflineItemState): string | undefined {
  if (state === "ready") {
    return "bg-accent-action/[0.04] hover:bg-accent-action/[0.08] focus-within:bg-accent-action/[0.08]";
  }
  if (isOfflineBusy(state)) {
    return "bg-accent-action/[0.05] hover:bg-accent-action/[0.09] focus-within:bg-accent-action/[0.09]";
  }
  if (state === "error") {
    return "bg-state-warning/[0.05] hover:bg-state-warning/[0.09] focus-within:bg-state-warning/[0.09]";
  }
  return "focus-within:bg-text-primary/5";
}

function OfflineMeta({
  meta,
  state,
}: {
  meta: string | null;
  state: OfflineItemState;
}) {
  if (!meta) return null;
  return (
    <span className={cn("ml-1.5", offlineMetaClass(state))}>· {meta}</span>
  );
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function usePendingHandler(getHandler: () => Handler | undefined) {
  const [pending, setPending] = useState(false);
  const getHandlerRef = useLatest(getHandler);
  const run = useCallback(async () => {
    const handler = getHandlerRef.current();
    if (!handler) return;
    setPending(true);
    try {
      await handler();
    } finally {
      setPending(false);
    }
  }, [getHandlerRef]);
  return [pending, run] as const;
}

function usePlaylistCardBase(props: PlaylistCardProps) {
  const { t } = useTranslation();
  const { getPlaylistState, getPlaylistRecord } = useOffline();
  const offlineState = getPlaylistState(props.playlistId);
  const offlineMeta = getPlaylistOfflineMeta(
    offlineState,
    getPlaylistRecord(props.playlistId),
    t,
  );
  const latest = useLatest(props);
  const handleOpen = useCallback(() => latest.current.onClick?.(), [latest]);
  const [playing, runPlay] = usePendingHandler(() => latest.current.onPlay);
  const [togglingFollow, runToggleFollow] = usePendingHandler(
    () => latest.current.onToggleFollow,
  );
  const canFollow = Boolean(props.systemPlaylist && props.onToggleFollow);

  return {
    t,
    offlineState,
    offlineMeta,
    canFollow,
    handleOpen: props.onClick ? handleOpen : undefined,
    href: props.onClick ? undefined : props.href,
    playing,
    runPlay,
    togglingFollow,
    runToggleFollow,
  };
}

function useCardOverlay(
  props: PlaylistCardProps,
  base: ReturnType<typeof usePlaylistCardBase>,
): EntityCardOverlay | undefined {
  const { t, canFollow, playing, runPlay, togglingFollow, runToggleFollow } =
    base;
  const hasPlay = Boolean(props.onPlay);
  const isFollowed = Boolean(props.isFollowed);
  const playLabel = t("common.playItem", { name: props.name });
  const followLabel = t("actions.playlist.addToLibrary");
  const unfollowLabel = t("actions.playlist.removeFromLibrary");

  return useMemo(() => {
    if (!hasPlay && !canFollow) return undefined;
    return {
      onPlay: hasPlay ? () => void runPlay() : undefined,
      loading: playing,
      playLabel,
      follow: canFollow
        ? {
            following: isFollowed,
            loading: togglingFollow,
            label: followLabel,
            labelActive: unfollowLabel,
            onToggle: () => void runToggleFollow(),
          }
        : undefined,
    };
  }, [
    canFollow,
    followLabel,
    hasPlay,
    isFollowed,
    playLabel,
    playing,
    runPlay,
    runToggleFollow,
    togglingFollow,
    unfollowLabel,
  ]);
}

function PlaylistTileArtwork({
  crateManaged,
  isSmart,
  name,
  coverDataUrl,
  tracks,
  badge,
}: Pick<
  PlaylistCardProps,
  "crateManaged" | "isSmart" | "name" | "coverDataUrl" | "tracks" | "badge"
>) {
  const { t } = useTranslation();
  const className =
    "size-full rounded-lg transition-transform group-hover:scale-[1.02]";

  if (crateManaged) {
    const label = editorialPlaylistLabel(name, isSmart ? "core" : "crate");
    return (
      <EditorialPlaylistArtwork
        title={label.title}
        kicker={t(EDITORIAL_PLAYLIST_KICKER_KEYS[label.kind])}
        coverDataUrl={coverDataUrl}
        tracks={tracks}
        variant="core"
        className={className}
      />
    );
  }

  return (
    <>
      <PlaylistArtwork
        name={name}
        coverDataUrl={coverDataUrl}
        tracks={tracks}
        showCrateMark={false}
        className={className}
      />
      {badge ? (
        <span className="absolute bottom-2 left-2 rounded-full border border-accent-action/20 bg-surface-canvas/85 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-action backdrop-blur-md">
          {badge}
        </span>
      ) : null}
    </>
  );
}

function PlaylistTile(props: PlaylistCardProps) {
  const { name, description, meta, badge, layout = "rail" } = props;
  const base = usePlaylistCardBase(props);
  const { t, offlineState, offlineMeta } = base;
  const overlay = useCardOverlay(props, base);
  const actionMenu = usePlaylistActionMenu(
    {
      playlistId: props.playlistId,
      name,
      isSmart: props.isSmart,
      href: props.href,
      canFollow: base.canFollow,
      isFollowed: props.isFollowed,
      onToggleFollow: props.onToggleFollow,
      onPlay: props.onPlay,
      onShuffle: props.onShuffle,
      onStartRadio: props.onStartRadio,
    },
    { title: name, subtitle: description || meta, detail: badge },
  );

  return (
    <EntityCard
      title={name}
      subtitle={
        <>
          {description || meta}
          <OfflineMeta meta={offlineMeta} state={offlineState} />
        </>
      }
      titleAccessory={<OfflineBadge state={offlineState} compact />}
      artwork={<PlaylistTileArtwork {...props} />}
      layout={layout}
      overlay={overlay}
      onOpen={base.handleOpen}
      href={base.href}
      openLabel={t("common.openItem", { name })}
      menuLabel={t("actions.menu.more")}
      actionMenu={actionMenu}
      className={cn(tileSurfaceClass(offlineState), props.className)}
    />
  );
}

const FEATURED_ARTWORK_CLASS_NAME =
  "size-full rounded-xl transition-transform group-hover:scale-[1.02]";

function PlaylistFeatured(props: PlaylistCardProps) {
  const { name, summary, meta, artworkOnly = false } = props;
  const base = usePlaylistCardBase(props);
  const overlay = useCardOverlay(props, base);
  const actionMenu = usePlaylistActionMenu(
    {
      playlistId: props.playlistId,
      name,
      isSmart: props.isSmart,
      href: props.href,
      onPlay: props.onPlay,
      onShuffle: props.onShuffle,
      onStartRadio: props.onStartRadio,
    },
    {
      title: name,
      subtitle: summary ?? meta,
      detail: summary ? meta : undefined,
    },
  );

  return (
    <EntityCard
      title={name}
      subtitle={
        summary && !artworkOnly ? (
          <span className="mt-1 line-clamp-2 min-h-[2.5rem] whitespace-normal leading-5">
            {summary}
          </span>
        ) : undefined
      }
      meta={
        meta && !artworkOnly ? (
          <span className="home-discovery-meta mt-2 block uppercase tracking-eyebrow">
            {meta}
          </span>
        ) : undefined
      }
      artwork={props.renderArtwork?.(FEATURED_ARTWORK_CLASS_NAME)}
      shape="rounded"
      layout="grid"
      overlay={overlay}
      onOpen={base.handleOpen}
      href={base.href}
      openLabel={base.t("common.openItem", { name })}
      menuLabel={base.t("actions.menu.more")}
      actionMenu={actionMenu}
      className={props.className}
      classNames={{
        artwork: cn("home-discovery-artwork", artworkOnly && "mb-0"),
        title: artworkOnly ? "sr-only" : "font-semibold",
      }}
    />
  );
}

function PlaylistRowActions({
  onPlay,
  onShuffle,
  playingMode,
  canFollow,
  isFollowed,
  togglingFollow,
  onToggleFollow,
  extraActions,
}: {
  onPlay?: () => void;
  onShuffle?: () => void;
  playingMode: "play" | "shuffle" | null;
  canFollow: boolean;
  isFollowed: boolean;
  togglingFollow: boolean;
  onToggleFollow: () => void;
  extraActions?: PlaylistCardExtraAction[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {onPlay ? (
        <IconButton
          label={t("player.play")}
          onClick={onPlay}
          loading={playingMode === "play"}
        >
          <Play
            size={CRATE_ICON_SIZE.sm}
            fill="currentColor"
            className="ml-0.5"
          />
        </IconButton>
      ) : null}
      {onShuffle ? (
        <IconButton
          label={t("player.shuffle")}
          onClick={onShuffle}
          loading={playingMode === "shuffle"}
        >
          <Shuffle size={CRATE_ICON_SIZE.sm} />
        </IconButton>
      ) : null}
      {canFollow ? (
        <FollowHeartButton
          following={isFollowed}
          loading={togglingFollow}
          label={t("common.follow")}
          labelActive={t("common.following")}
          title={t(isFollowed ? "common.following" : "common.follow")}
          iconSize={CRATE_ICON_SIZE.sm}
          className="size-10 shrink-0 rounded-full"
          onClick={onToggleFollow}
        />
      ) : null}
      {extraActions?.map((item) => {
        const Icon = item.icon;
        return (
          <IconButton
            key={item.key}
            label={item.title}
            tone={item.tone}
            loading={item.loading}
            onClick={() => void item.onClick()}
          >
            <Icon size={CRATE_ICON_SIZE.sm} />
          </IconButton>
        );
      })}
    </>
  );
}

function PlaylistRow(props: PlaylistCardProps) {
  const {
    playlistId,
    name,
    description,
    meta,
    badge,
    trackCount = 0,
    detailEndpoint,
    extraActions,
  } = props;
  const base = usePlaylistCardBase(props);
  const { t, offlineState, offlineMeta } = base;
  const { loadAndPlay, playingMode } = usePlaylistListRowPlayback({
    detailEndpoint: detailEndpoint ?? "",
    name,
    playlistId,
  });
  const playHandlers = detailEndpoint
    ? {
        onPlay: () => loadAndPlay("play"),
        onShuffle: () => loadAndPlay("shuffle"),
      }
    : {};
  const extraEntries = useMemo<ItemActionMenuEntry[] | undefined>(
    () =>
      extraActions?.map((item) =>
        action({
          key: `extra-${item.key}`,
          label: item.title,
          icon: item.icon,
          danger: item.tone === "danger",
          onSelect: item.onClick,
        }),
      ),
    [extraActions],
  );
  const trackCountLabel = t("common.trackCountLabel", { count: trackCount });
  const subtitleText = meta ? `${trackCountLabel} · ${meta}` : trackCountLabel;
  const actionMenu = usePlaylistActionMenu(
    {
      playlistId,
      name,
      isSmart: props.isSmart,
      href: props.href,
      canFollow: base.canFollow,
      isFollowed: props.isFollowed,
      onToggleFollow: props.onToggleFollow,
      onStartRadio: props.onStartRadio,
      extraEntries,
      ...playHandlers,
    },
    { title: name, subtitle: subtitleText, detail: description },
  );

  return (
    <EntityRow
      title={name}
      titleAccessory={
        <>
          {badge ? (
            <CrateChip
              tone="accent"
              icon={Sparkles}
              className="shrink-0 py-0 text-xs font-medium"
            >
              {badge}
            </CrateChip>
          ) : null}
          <OfflineBadge state={offlineState} compact />
        </>
      }
      subtitle={
        <>
          {subtitleText}
          <OfflineMeta meta={offlineMeta} state={offlineState} />
        </>
      }
      meta={description || undefined}
      leading={
        <PlaylistArtwork
          name={name}
          coverDataUrl={props.coverDataUrl}
          tracks={props.tracks}
          showCrateMark={props.crateManaged}
          className="size-12 shrink-0 rounded-md"
        />
      }
      trailing={
        <PlaylistRowActions
          onPlay={detailEndpoint ? () => void loadAndPlay("play") : undefined}
          onShuffle={
            detailEndpoint ? () => void loadAndPlay("shuffle") : undefined
          }
          playingMode={playingMode}
          canFollow={base.canFollow}
          isFollowed={Boolean(props.isFollowed)}
          togglingFollow={base.togglingFollow}
          onToggleFollow={() => void base.runToggleFollow()}
          extraActions={extraActions}
        />
      }
      onOpen={base.handleOpen}
      href={base.href}
      openLabel={t("common.openItem", { name })}
      menuLabel={t("actions.menu.more")}
      menuButton="always"
      actionMenu={actionMenu}
      className={cn(rowSurfaceClass(offlineState), props.className)}
      classNames={{
        meta: "mt-1 text-text-primary/40",
        trailing: "gap-1",
        menuButton: "opacity-80 transition-opacity hover:opacity-100",
      }}
    />
  );
}

export const PlaylistCard = memo(function PlaylistCard({
  variant = "tile",
  ...props
}: PlaylistCardProps) {
  if (variant === "row") return <PlaylistRow {...props} />;
  if (variant === "featured") return <PlaylistFeatured {...props} />;
  return <PlaylistTile {...props} />;
});
