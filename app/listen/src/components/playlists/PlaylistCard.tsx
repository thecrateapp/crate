import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, HeartBold, Loader2, Play, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
  useItemActionTarget,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import {
  EDITORIAL_PLAYLIST_KICKER_KEYS,
  EditorialPlaylistArtwork,
  editorialPlaylistLabel,
} from "@/components/playlists/EditorialPlaylistArtwork";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import {
  getOfflineStateLabel,
  isOfflineBusy,
  type OfflineItemState,
} from "@/lib/offline";
import { cn } from "@/lib/utils";

interface PlaylistOfflineRecord {
  trackCount?: number;
  readyTrackCount?: number;
}

function getPlaylistOfflineMeta(
  state: OfflineItemState,
  record: PlaylistOfflineRecord | null | undefined,
  t: ReturnType<typeof useTranslation>["t"],
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

function getPlaylistOfflineSurfaceClass(state: OfflineItemState): string {
  if (state === "ready") return "bg-accent-action/[0.04]";
  if (isOfflineBusy(state)) return "bg-accent-action/[0.05]";
  if (state === "error") return "bg-state-warning/[0.05]";
  return "hover:bg-text-primary/5";
}

function getPlaylistOfflineMetaClass(
  state: OfflineItemState,
): string | undefined {
  if (state === "ready") return "text-text-accent/90";
  if (isOfflineBusy(state)) return "text-accent-action";
  if (state === "error") return "text-state-warning-text/90";
  return undefined;
}

function getPlaylistBadgePositionClass(
  badge: string | undefined,
  crateManaged: boolean,
): string {
  return badge && !crateManaged
    ? "absolute left-2 top-8"
    : "absolute left-2 top-2";
}

interface PlaylistCardArtworkProps {
  crateManaged: boolean;
  editorialLabel: ReturnType<typeof editorialPlaylistLabel>;
  coverDataUrl: string | null | undefined;
  tracks: PlaylistArtworkTrack[] | undefined;
  name: string;
}

function PlaylistCardArtwork({
  crateManaged,
  editorialLabel,
  coverDataUrl,
  tracks,
  name,
}: PlaylistCardArtworkProps) {
  const { t } = useTranslation();
  if (crateManaged) {
    return (
      <EditorialPlaylistArtwork
        title={editorialLabel.title}
        kicker={t(EDITORIAL_PLAYLIST_KICKER_KEYS[editorialLabel.kind])}
        coverDataUrl={coverDataUrl}
        tracks={tracks}
        variant="core"
        className="aspect-square rounded-lg transition-transform group-hover:scale-[1.02]"
      />
    );
  }

  return (
    <PlaylistArtwork
      name={name}
      coverDataUrl={coverDataUrl}
      tracks={tracks}
      showCrateMark={false}
      className="aspect-square rounded-lg transition-transform group-hover:scale-[1.02]"
    />
  );
}

function PlaylistCardFollowButton({
  isFollowed,
  onToggleFollow,
}: {
  isFollowed: boolean;
  onToggleFollow: () => Promise<void> | void;
}) {
  const [togglingFollow, setTogglingFollow] = useState(false);

  return (
    <ActionIconButton
      variant="card"
      active={isFollowed}
      className="pointer-events-auto absolute top-2 right-2 z-10 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
      onClick={async (event) => {
        event.stopPropagation();
        setTogglingFollow(true);
        try {
          await onToggleFollow();
        } finally {
          setTogglingFollow(false);
        }
      }}
    >
      {togglingFollow ? (
        <Loader2 size={16} className="animate-spin" />
      ) : isFollowed ? (
        <HeartBold size={16} />
      ) : (
        <Heart size={16} />
      )}
    </ActionIconButton>
  );
}

function PlaylistCardPlayButton({
  onPlay,
}: {
  onPlay: () => Promise<void> | void;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface-canvas/0 transition-colors group-hover:bg-surface-canvas/40">
      <button
        type="button"
        className="pointer-events-auto flex size-10 translate-y-2 items-center justify-center rounded-full bg-accent-action opacity-0 shadow-lg transition-[transform,opacity] focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
        onClick={async (event) => {
          event.stopPropagation();
          setPlaying(true);
          try {
            await onPlay();
          } finally {
            setPlaying(false);
          }
        }}
      >
        {playing ? (
          <Loader2
            size={18}
            className="animate-spin text-accent-action-foreground"
          />
        ) : (
          <Play
            size={18}
            fill="currentColor"
            className="ml-0.5 text-accent-action-foreground"
          />
        )}
      </button>
    </div>
  );
}

interface PlaylistCardProps {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  badge?: string;
  systemPlaylist?: boolean;
  crateManaged?: boolean;
  isFollowed?: boolean;
  href?: string;
  layout?: "rail" | "grid";
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onShuffle?: () => Promise<void> | void;
  onStartRadio?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}

export function PlaylistCard({
  playlistId,
  name,
  isSmart = false,
  description,
  tracks,
  coverDataUrl,
  meta,
  badge,
  systemPlaylist = false,
  crateManaged = false,
  isFollowed = false,
  href,
  layout = "rail",
  onClick,
  onPlay,
  onShuffle,
  onStartRadio,
  onToggleFollow,
}: PlaylistCardProps) {
  const { t } = useTranslation();
  const { getPlaylistState, getPlaylistRecord } = useOffline();
  const offlineState = getPlaylistState(playlistId);
  const offlineRecord = getPlaylistRecord(playlistId);
  const offlineMeta = getPlaylistOfflineMeta(offlineState, offlineRecord, t);
  const actions = usePlaylistActionEntries({
    playlistId,
    name,
    isSmart,
    href,
    canFollow: systemPlaylist && Boolean(onToggleFollow),
    isFollowed,
    onToggleFollow,
    onPlay,
    onShuffle,
    onStartRadio,
  });
  const actionMenu = useItemActionMenu(actions);
  const actionTarget = useItemActionTarget(actionMenu);
  const editorialLabel = editorialPlaylistLabel(
    name,
    isSmart ? "core" : "crate",
  );

  return (
    <article
      className={cn(
        "item-action-target group relative rounded-xl text-left transition-colors",
        layout === "grid" ? "w-full min-w-0" : "w-[160px] shrink-0",
        getPlaylistOfflineSurfaceClass(offlineState),
      )}
      {...actionTarget}
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full cursor-pointer rounded-xl p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="relative mb-2 block overflow-hidden rounded-lg bg-text-primary/5">
          <PlaylistCardArtwork
            crateManaged={crateManaged}
            editorialLabel={editorialLabel}
            coverDataUrl={coverDataUrl}
            tracks={tracks}
            name={name}
          />
          {badge && !crateManaged ? (
            <span className="absolute left-2 top-2 rounded-full border border-accent-action/20 bg-surface-canvas/85 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-action backdrop-blur-md">
              {badge}
            </span>
          ) : null}
          <OfflineBadge
            state={offlineState}
            compact
            className={getPlaylistBadgePositionClass(badge, crateManaged)}
          />
        </span>
        <span className="block truncate text-sm font-medium text-text-primary">
          {name}
        </span>
        <span className="block truncate text-xs text-text-muted">
          {description || meta}
          {offlineMeta ? (
            <span
              className={cn(
                "ml-1.5",
                getPlaylistOfflineMetaClass(offlineState),
              )}
            >
              · {offlineMeta}
            </span>
          ) : null}
        </span>
      </button>
      {(systemPlaylist && onToggleFollow) || onPlay ? (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 aspect-square">
          {systemPlaylist && onToggleFollow ? (
            <PlaylistCardFollowButton
              isFollowed={isFollowed}
              onToggleFollow={onToggleFollow}
            />
          ) : null}
          {onPlay ? <PlaylistCardPlayButton onPlay={onPlay} /> : null}
        </div>
      ) : null}
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: name,
          subtitle: description || meta,
          detail: badge,
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </article>
  );
}
