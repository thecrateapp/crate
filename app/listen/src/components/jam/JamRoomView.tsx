import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Globe2,
  GripVertical,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  QrCode,
  Radio,
  Search,
  Share2,
  SkipForward,
  Trash2,
  Zap,
} from "@crate/ui/icons";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TFunction } from "i18next";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { Button } from "@crate/ui/shadcn/button";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import type { AuthUser } from "@/contexts/auth-context";
import type { Track } from "@/contexts/PlayerContext";
import { JamAvatarBubble } from "@/components/jam/JamAvatarBubble";
import type {
  JamQueueItem,
  JamQueueMode,
  JamRoom,
  JamTrackRequest,
  SearchTrack,
} from "@/pages/jam-reducer";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { formatDuration } from "@/lib/utils";
import { payloadToTrack } from "@/pages/jam-reducer";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import {
  eventActivityText,
  resolveJamActor,
  searchTrackToTrack,
  trackIdentity,
  displayName,
} from "@/pages/jam-session-utils";

const jamQueueItemClassName =
  "jam-queue-item flex items-center gap-3 rounded-lg px-3 py-3";

interface HeroActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

function HeroActionButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroActionButtonProps) {
  return (
    <ActionIconButton
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`jam-hero-action h-11 w-11 text-text-muted disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
    </ActionIconButton>
  );
}

interface HeroPrimaryButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

function HeroPrimaryButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroPrimaryButtonProps) {
  return (
    <Button
      type="button"
      aria-label={label}
      disabled={disabled || loading}
      variant="outline"
      size="lg"
      className={`h-11 px-3.5 disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
      <span>{label}</span>
    </Button>
  );
}

function SortableJamQueueItem({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={jamQueueItemClassName}
    >
      <button
        type="button"
        aria-label={dragLabel}
        title={dragLabel}
        className="shrink-0 touch-none cursor-grab text-text-muted/60 hover:text-text-primary active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      {children}
    </div>
  );
}

function JamQueueItemShell({
  sortable,
  id,
  dragLabel,
  children,
}: {
  sortable: boolean;
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  if (sortable) {
    return (
      <SortableJamQueueItem id={id} dragLabel={dragLabel}>
        {children}
      </SortableJamQueueItem>
    );
  }
  return <div className={jamQueueItemClassName}>{children}</div>;
}

interface JamRoomViewProps {
  t: TFunction;
  room: JamRoom;
  inviteLink: string | null;
  queueMode: JamQueueMode;
  isConnected: boolean;
  connectionProblem: string | null;
  roomIsActive: boolean;
  isHost: boolean;
  currentTrackAlreadyQueued: boolean;
  queuePrimaryActionLabel: string;
  shareCurrentTrack: () => void;
  handlePlayRoomQueue: () => void;
  queueItems: JamQueueItem[];
  roomActionsOpen: boolean;
  setRoomActionsOpen: Dispatch<SetStateAction<boolean>>;
  roomNowPlaying: Track | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  toggleRoomPlayback: () => void;
  handlePlayNext: () => void;
  syncStatus: "idle" | "synced" | "drifting";
  syncPlaybackState: () => void;
  canAddToQueue: boolean;
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  updateRoomSettings: (
    patch: Partial<
      Pick<
        JamRoom,
        | "name"
        | "visibility"
        | "is_permanent"
        | "description"
        | "tags"
        | "queue_mode"
        | "auto_dj_voting"
        | "genre_filters"
      >
    >,
    field: "visibility" | "permanent" | "metadata" | "queue_mode",
  ) => Promise<boolean>;
  openMetadataModal: () => void;
  handleCreateInvite: () => void | Promise<void>;
  creatingInvite: boolean;
  handleEndRoom: () => void | Promise<void>;
  endingRoom: boolean;
  requestDeleteRoom: (room: JamRoom) => void;
  deletingRoomId: string | null;
  pendingRequests: JamTrackRequest[];
  canManageQueue: boolean;
  handleResolveRequest: (requestId: string, approve: boolean) => void;
  user: AuthUser | null;
  autoDjSuggestions: Track[];
  queueSearchInputRef: RefObject<HTMLInputElement | null>;
  queueSearch: string;
  setQueueSearch: (value: string) => void;
  canEditQueue: boolean;
  queueSearchLoading: boolean;
  queueSearchResults: SearchTrack[];
  addSearchTrackToRoom: (track: SearchTrack) => void;
  queueSensors: ComponentProps<typeof DndContext>["sensors"];
  handleQueueDragEnd: (event: DragEndEvent) => void;
  handleVote: (item: JamQueueItem) => void;
  handleMoveInRoomQueue: (
    queueItemId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  handleRemoveFromRoomQueue: (queueItemId: string) => void;
  focusQueueSearch: () => void;
  toggleQueueMode: () => void;
  enableAutoDj: () => void;
  metadataModalOpen: boolean;
  setMetadataModalOpen: (value: boolean) => void;
  metadataDescription: string;
  setMetadataDescription: (value: string) => void;
  metadataTagsInput: string;
  setMetadataTagsInput: (value: string) => void;
  saveRoomMetadata: () => void | Promise<void>;
  deleteRoomModal: ReactNode;
  inviteModalOpen: boolean;
  setInviteModalOpen: (value: boolean) => void;
  copyInviteLink: (link: string) => void | Promise<void>;
}

export function JamRoomView({
  t,
  room,
  inviteLink,
  queueMode,
  isConnected,
  connectionProblem,
  roomIsActive,
  isHost,
  currentTrackAlreadyQueued,
  queuePrimaryActionLabel,
  shareCurrentTrack,
  handlePlayRoomQueue,
  queueItems,
  roomActionsOpen,
  setRoomActionsOpen,
  roomNowPlaying,
  currentTime,
  duration,
  isPlaying,
  toggleRoomPlayback,
  handlePlayNext,
  syncStatus,
  syncPlaybackState,
  canAddToQueue,
  updatingRoomField,
  updateRoomSettings,
  openMetadataModal,
  handleCreateInvite,
  creatingInvite,
  handleEndRoom,
  endingRoom,
  requestDeleteRoom,
  deletingRoomId,
  pendingRequests,
  canManageQueue,
  handleResolveRequest,
  user,
  autoDjSuggestions,
  queueSearchInputRef,
  queueSearch,
  setQueueSearch,
  canEditQueue,
  queueSearchLoading,
  queueSearchResults,
  addSearchTrackToRoom,
  queueSensors,
  handleQueueDragEnd,
  handleVote,
  handleMoveInRoomQueue,
  handleRemoveFromRoomQueue,
  focusQueueSearch,
  toggleQueueMode,
  enableAutoDj,
  metadataModalOpen,
  setMetadataModalOpen,
  metadataDescription,
  setMetadataDescription,
  metadataTagsInput,
  setMetadataTagsInput,
  saveRoomMetadata,
  deleteRoomModal,
  inviteModalOpen,
  setInviteModalOpen,
  copyInviteLink,
}: JamRoomViewProps) {
  return (
    <div className="space-y-6">
      <div className="jam-room-header rounded-[12px] p-5 sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="jam-accent-text text-xs uppercase tracking-wide">
                {t("jam.room.eyebrow")}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-bold text-text-primary">
                  {room.name}
                </h1>
                <div className="jam-accent-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                  <Zap size={12} />
                  {queueMode === "auto_dj"
                    ? t("jam.room.autoDjMode")
                    : queueMode === "auto"
                      ? t("jam.room.autoMode")
                      : t("jam.room.djMode")}
                </div>
                <div className="jam-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-text-muted">
                  {room.visibility === "public" ? (
                    <Globe2 size={12} />
                  ) : (
                    <Lock size={12} />
                  )}
                  {room.visibility === "public"
                    ? t("jam.room.publicRoom")
                    : t("jam.visibility.inviteOnly")}
                </div>
                {room.is_permanent ? (
                  <div className="jam-accent-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                    <Pin size={12} />
                    {t("jam.roomCard.permanent")}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-text-muted">
                {room.description ||
                  t("jam.room.defaultDescription", {
                    count: room.members.length,
                  })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isConnected ? (
                  <div className="jam-success-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                    <Radio size={12} className="jam-success-text" />
                    {t("jam.room.connected")}
                  </div>
                ) : (
                  <div className="jam-warning-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                    {connectionProblem &&
                    !connectionProblem.includes("Retrying") ? (
                      <Radio size={12} />
                    ) : (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    {connectionProblem || t("jam.room.connecting")}
                  </div>
                )}
                {!roomIsActive ? (
                  <div className="jam-warning-chip inline-flex rounded-full px-3 py-1 text-xs font-medium">
                    {t("jam.room.ended")}
                  </div>
                ) : null}
                {queueMode === "auto_dj" &&
                (room.genre_filters || []).length ? (
                  <div className="jam-info-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                    {t("jam.room.autoDjGenres", {
                      genres: (room.genre_filters || []).join(", "),
                    })}
                  </div>
                ) : null}
                {(room.tags || []).map((tag) => (
                  <div
                    key={tag}
                    className="jam-chip inline-flex rounded-full px-3 py-1 text-xs font-medium text-text-muted"
                  >
                    {tag}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <HeroPrimaryButton
                label={queuePrimaryActionLabel}
                onClick={shareCurrentTrack}
                disabled={
                  !roomIsActive || !isConnected || currentTrackAlreadyQueued
                }
                title={
                  currentTrackAlreadyQueued
                    ? t("jam.toasts.trackAlreadyInQueue")
                    : undefined
                }
                className="jam-accent-chip"
              >
                <Plus size={17} />
              </HeroPrimaryButton>
              <HeroPrimaryButton
                label={t("jam.room.actions.playRoomQueue")}
                onClick={handlePlayRoomQueue}
                disabled={queueItems.length === 0 || !isHost || !isConnected}
              >
                <ListMusic size={17} />
              </HeroPrimaryButton>
              {isHost ? (
                <HeroActionButton
                  label={t("jam.room.actions.roomSettings")}
                  aria-expanded={roomActionsOpen}
                  onClick={() => setRoomActionsOpen((open) => !open)}
                  className={roomActionsOpen ? "jam-accent-chip" : ""}
                >
                  <MoreHorizontal size={18} />
                </HeroActionButton>
              ) : null}
            </div>
          </div>

          <div className="jam-now-playing grid min-w-0 gap-4 rounded-xl p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
            <div className="flex min-w-0 items-center gap-4">
              {roomNowPlaying?.albumCover ? (
                <CrateImage
                  src={roomNowPlaying.albumCover}
                  alt=""
                  className="jam-artwork-shadow h-16 w-16 shrink-0 rounded-lg object-cover sm:h-20 sm:w-20"
                />
              ) : (
                <div className="jam-artwork-placeholder flex h-16 w-16 shrink-0 items-center justify-center rounded-lg sm:h-20 sm:w-20">
                  <ListMusic size={22} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="jam-accent-text text-[11px] uppercase tracking-[0.16em]">
                  {t("jam.room.nowPlaying")}
                </div>
                {roomNowPlaying ? (
                  <>
                    <div className="mt-1 truncate text-lg font-semibold text-text-primary sm:text-xl">
                      {roomNowPlaying.title}
                    </div>
                    <div className="truncate text-sm text-text-muted">
                      {roomNowPlaying.artist}
                      {roomNowPlaying.album ? ` · ${roomNowPlaying.album}` : ""}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-text-muted">
                    {t("jam.toasts.roomQueueEmpty")}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <div className="jam-progress-track h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                    <div
                      className="jam-progress-fill h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${
                          duration > 0
                            ? Math.min(
                                100,
                                Math.max(0, (currentTime / duration) * 100),
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                    {formatDuration(currentTime)} / {formatDuration(duration)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 md:justify-end">
              {isHost ? (
                <>
                  <HeroActionButton
                    label={
                      isPlaying
                        ? t("jam.room.actions.pauseRoom")
                        : t("jam.room.actions.playRoom")
                    }
                    onClick={toggleRoomPlayback}
                    disabled={!roomIsActive || !isConnected}
                    className="h-12 w-12 jam-accent-chip"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </HeroActionButton>
                  <HeroActionButton
                    label={t("jam.room.actions.playNextTrack")}
                    onClick={handlePlayNext}
                    disabled={
                      !roomIsActive || !isConnected || queueItems.length === 0
                    }
                    className="h-12 w-12"
                  >
                    <SkipForward size={19} />
                  </HeroActionButton>
                  <HeroActionButton
                    label={
                      syncStatus === "synced"
                        ? t("jam.room.actions.resyncPlayback")
                        : t("jam.room.actions.syncPlayback")
                    }
                    onClick={syncPlaybackState}
                    disabled={!roomIsActive || !isConnected || !roomNowPlaying}
                    className={`h-12 w-12 ${
                      syncStatus === "synced" ? "jam-success-chip" : ""
                    }`}
                  >
                    <Zap size={19} />
                  </HeroActionButton>
                </>
              ) : (
                <div
                  title={
                    syncStatus === "synced"
                      ? t("jam.room.syncedWithHost")
                      : syncStatus === "drifting"
                        ? t("jam.room.catchingUp")
                        : t("jam.room.waitingForHost")
                  }
                  className="jam-chip inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-text-muted"
                >
                  <Zap size={15} className="jam-accent-text" />
                  {syncStatus === "synced"
                    ? t("jam.room.synced")
                    : t("jam.room.waitingForHost")}
                </div>
              )}
            </div>
          </div>

          {roomActionsOpen && isHost ? (
            <div className="jam-room-actions-panel flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t("jam.room.actions.editProfile")}
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {t("jam.room.members")} · {room.members.length}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <HeroActionButton
                  label={
                    room.visibility === "public"
                      ? t("jam.room.actions.makeInviteOnly")
                      : t("jam.room.actions.makePublic")
                  }
                  onClick={() =>
                    void updateRoomSettings(
                      {
                        visibility:
                          room.visibility === "public" ? "private" : "public",
                      },
                      "visibility",
                    )
                  }
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "visibility"}
                >
                  {room.visibility === "public" ? (
                    <Lock size={16} />
                  ) : (
                    <Globe2 size={16} />
                  )}
                </HeroActionButton>
                <HeroActionButton
                  label={
                    room.is_permanent
                      ? t("jam.room.actions.unpinPermanent")
                      : t("jam.room.actions.makePermanent")
                  }
                  onClick={() =>
                    void updateRoomSettings(
                      { is_permanent: !room.is_permanent },
                      "permanent",
                    )
                  }
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "permanent"}
                >
                  <Pin size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.editProfile")}
                  onClick={openMetadataModal}
                  disabled={updatingRoomField !== null}
                  loading={updatingRoomField === "metadata"}
                >
                  <ListMusic size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.invitePeople")}
                  onClick={handleCreateInvite}
                  disabled={!roomIsActive}
                  loading={creatingInvite}
                >
                  <Share2 size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.endRoom")}
                  onClick={handleEndRoom}
                  disabled={!roomIsActive}
                  loading={endingRoom}
                  className="jam-danger-control"
                >
                  <Power size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.delete.title")}
                  onClick={() => requestDeleteRoom(room)}
                  disabled={deletingRoomId === room.id}
                  loading={deletingRoomId === room.id}
                  className="jam-danger-control"
                >
                  <Trash2 size={16} />
                </HeroActionButton>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 gap-6 xl:grid-cols-[0.85fr_1.1fr_1.1fr]">
        <section className="jam-members-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.room.members")}
          </h2>
          {pendingRequests.length > 0 ? (
            <div className="jam-request-panel mt-4 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="jam-warning-text text-sm font-medium">
                  {t("jam.room.pendingRequests")}
                </div>
                <div className="jam-request-count rounded-full px-2 py-0.5 text-[11px]">
                  {pendingRequests.length}
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="jam-queue-item flex items-center gap-2 rounded-lg px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-text-primary">
                        {request.track.title}
                      </div>
                      <div className="truncate text-[11px] text-text-muted">
                        {request.track.artist}
                        {request.requester_name
                          ? ` · ${request.requester_name}`
                          : ""}
                      </div>
                    </div>
                    {canManageQueue ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleResolveRequest(request.id, true)}
                          className="jam-request-action rounded-md px-2 py-1 text-[11px] font-medium"
                        >
                          {t("jam.room.approveRequest")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleResolveRequest(request.id, false)
                          }
                          className="jam-secondary-action rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors"
                        >
                          {t("jam.room.rejectRequest")}
                        </button>
                      </>
                    ) : (
                      <span className="jam-warning-text text-[11px]">
                        {t("jam.room.waitingForHost")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {room.members.map((member) => (
              <UserProfileLink
                key={`${member.room_id}-${member.user_id}`}
                username={member.username}
                hoverClassName="block"
                className="jam-card-interactive flex items-center justify-between gap-3 rounded-lg px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <JamAvatarBubble
                    name={displayName(member)}
                    avatar={member.avatar}
                    userId={member.user_id}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {displayName(member)}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {member.username
                        ? `@${member.username}`
                        : t("jam.room.profile")}{" "}
                      · {member.role}
                    </div>
                  </div>
                </div>
                <div className="jam-chip rounded-full px-2.5 py-1 text-[11px] text-text-muted">
                  {member.user_id === room.host_user_id
                    ? t("jam.room.roles.host")
                    : t("jam.room.roles.collab")}
                </div>
              </UserProfileLink>
            ))}
          </div>
        </section>

        <section className="jam-queue-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {t("jam.room.sharedQueue")}
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                {queueMode === "auto_dj"
                  ? t("jam.room.autoDjQueueSubtitle")
                  : queueMode === "auto"
                    ? t("jam.room.autoQueueSubtitle")
                    : t("jam.room.manualQueueSubtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="jam-chip rounded-full px-2.5 py-1 text-[11px] text-text-muted">
                {t("jam.room.queueTrackCount", { count: queueItems.length })}
              </div>
            </div>
          </div>

          {isHost ? (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={toggleQueueMode}
                disabled={updatingRoomField !== null || !roomIsActive}
                className="jam-accent-control flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs disabled:opacity-50"
              >
                <span>
                  <span className="block font-medium">
                    {queueMode === "auto" || queueMode === "auto_dj"
                      ? t("jam.room.switchToDjMode")
                      : t("jam.room.switchToAutoMode")}
                  </span>
                  <span className="jam-accent-text mt-0.5 block opacity-60">
                    {queueMode === "auto" || queueMode === "auto_dj"
                      ? t("jam.room.autoModeHelp")
                      : t("jam.room.djModeHelp")}
                  </span>
                </span>
                <Zap size={16} />
              </button>
              {queueMode !== "auto_dj" ? (
                <button
                  type="button"
                  onClick={enableAutoDj}
                  disabled={updatingRoomField !== null || !roomIsActive}
                  className="jam-info-chip flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs disabled:opacity-50"
                >
                  <span>
                    <span className="block font-medium">
                      {t("jam.room.switchToAutoDjMode")}
                    </span>
                    <span className="jam-info-text mt-0.5 block opacity-60">
                      {t("jam.room.autoDjModeHelp")}
                    </span>
                  </span>
                  <Zap size={16} />
                </button>
              ) : null}
            </div>
          ) : null}

          {queueMode === "auto_dj" && autoDjSuggestions.length > 0 ? (
            <div className="jam-info-chip mt-3 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="jam-info-text text-xs font-semibold uppercase tracking-wide">
                    {t("jam.room.autoDjSuggestions")}
                  </div>
                  <p className="jam-info-text mt-1 text-xs">
                    {t("jam.room.autoDjSuggestionsHelp")}
                  </p>
                </div>
                <Zap size={15} className="jam-info-text shrink-0" />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {autoDjSuggestions.slice(0, 4).map((track) => (
                  <div
                    key={trackIdentity(track)}
                    className="jam-queue-item flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2"
                  >
                    {track.albumCover ? (
                      <CrateImage
                        src={track.albumCover}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="jam-artwork-placeholder flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                        <ListMusic size={14} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-text-primary">
                        {track.title}
                      </div>
                      <div className="truncate text-[11px] text-text-muted">
                        {track.artist}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            <div className="jam-input flex items-center gap-2 rounded-lg px-3 py-2">
              <Search size={15} className="text-text-muted" />
              <input
                ref={queueSearchInputRef}
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
                disabled={!canEditQueue}
                placeholder={
                  canEditQueue
                    ? t("jam.room.queueSearchPlaceholder")
                    : t("jam.room.queueSearchDisabledPlaceholder")
                }
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
              />
              {queueSearchLoading ? (
                <Loader2
                  size={15}
                  className="animate-spin text-accent-action"
                />
              ) : null}
            </div>
            {queueSearchResults.length > 0 ? (
              <div className="jam-dark-surface overflow-hidden rounded-xl border border-border-quiet">
                {queueSearchResults.map((track) => {
                  const playable = searchTrackToTrack(track);
                  const alreadyQueued = queueItems.some((item) =>
                    playerTracksMatch(item.track, playable),
                  );
                  return (
                    <button
                      key={
                        playable.id ||
                        playable.path ||
                        `${track.artist}-${track.title}`
                      }
                      type="button"
                      onClick={() => addSearchTrackToRoom(track)}
                      disabled={alreadyQueued}
                      title={
                        alreadyQueued
                          ? t("jam.toasts.trackAlreadyInQueue")
                          : undefined
                      }
                      className="jam-queue-search-item flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default disabled:opacity-45"
                    >
                      {playable.albumCover ? (
                        <CrateImage
                          src={playable.albumCover}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="jam-artwork-placeholder flex h-10 w-10 items-center justify-center rounded-lg">
                          <ListMusic size={15} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {playable.title}
                        </div>
                        <div className="truncate text-xs text-text-muted">
                          {playable.artist}
                          {playable.album ? ` · ${playable.album}` : ""}
                        </div>
                      </div>
                      <span className="jam-accent-text text-[11px] font-medium">
                        {canAddToQueue
                          ? t("jam.room.addToQueue")
                          : t("jam.room.suggestTrack")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div
            data-testid="jam-shared-queue-list"
            className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1"
          >
            <DndContext
              collisionDetection={closestCenter}
              sensors={queueSensors}
              onDragEnd={handleQueueDragEnd}
            >
              <SortableContext
                items={queueItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {queueItems.map((item, index) => {
                  const track = item.track;
                  return (
                    <JamQueueItemShell
                      key={item.id}
                      sortable={canManageQueue}
                      id={item.id}
                      dragLabel={t("jam.room.queueDragAria", {
                        title: track.title,
                      })}
                    >
                      <div className="jam-subtle-text w-6 text-center text-xs">
                        {index + 1}
                      </div>
                      {track.albumCover ? (
                        <CrateImage
                          src={track.albumCover}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="jam-artwork-placeholder flex h-10 w-10 items-center justify-center rounded-lg">
                          <ListMusic size={15} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {track.title}
                        </div>
                        <div className="truncate text-xs text-text-muted">
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ""}
                        </div>
                      </div>
                      {["auto", "auto_dj"].includes(queueMode) &&
                      (queueMode !== "auto_dj" ||
                        room.auto_dj_voting !== false) ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <FollowHeartButton
                            following={item.voted_by_me}
                            disabled={item.voted_by_me || !isConnected}
                            onClick={() => handleVote(item)}
                            aria-label={t(
                              item.voted_by_me
                                ? "jam.room.queueVotedAria"
                                : "jam.room.queueVoteAria",
                              {
                                title: track.title,
                              },
                            )}
                            title={t(
                              item.voted_by_me
                                ? "jam.room.queueVotedAria"
                                : "jam.room.queueVoteAria",
                              {
                                title: track.title,
                              },
                            )}
                            iconSize={18}
                            className="rounded-full p-1 text-text-muted transition-colors hover:bg-surface-quiet-subtle disabled:cursor-default disabled:opacity-45"
                          />
                          <span
                            aria-label={t("jam.room.queueVoteCount", {
                              count: item.vote_count,
                            })}
                            className="min-w-4 text-center text-xs tabular-nums text-text-muted"
                          >
                            {item.vote_count}
                          </span>
                        </div>
                      ) : null}
                      {canManageQueue ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={t("jam.room.queueMoveUpAria", {
                              title: track.title,
                            })}
                            onClick={() =>
                              handleMoveInRoomQueue(item.id, index, index - 1)
                            }
                            disabled={index === 0}
                            className="jam-chip rounded-full p-1.5 text-text-muted hover:bg-surface-quiet-subtle disabled:opacity-30"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("jam.room.queueMoveDownAria", {
                              title: track.title,
                            })}
                            onClick={() =>
                              handleMoveInRoomQueue(item.id, index, index + 1)
                            }
                            disabled={index === queueItems.length - 1}
                            className="jam-chip rounded-full p-1.5 text-text-muted hover:bg-surface-quiet-subtle disabled:opacity-30"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("jam.room.queueRemoveAria", {
                              title: track.title,
                            })}
                            onClick={() => handleRemoveFromRoomQueue(item.id)}
                            className="jam-danger-control rounded-full p-1.5"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : null}
                    </JamQueueItemShell>
                  );
                })}
              </SortableContext>
            </DndContext>
            {queueItems.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-text-muted">
                  {t("jam.room.emptyQueuePrefix")}{" "}
                  <b>{queuePrimaryActionLabel}</b>{" "}
                  {t("jam.room.emptyQueueSuffix")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={focusQueueSearch}
                  className="jam-secondary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
                >
                  <Search size={15} />
                  {t("jam.room.browseLibrary")}
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="jam-activity-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.room.recentActivity")}
          </h2>
          <div className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1">
            {[...room.events]
              .reverse()
              .slice(0, 20)
              .map((event) => {
                const actor = resolveJamActor(event, room.members, user);
                const payload = (event.payload_json || {}) as Record<
                  string,
                  unknown
                >;
                const track = payloadToTrack(
                  payload.track as Record<string, unknown> | undefined,
                );
                return (
                  <div
                    key={event.id}
                    className="jam-activity-card rounded-xl px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <JamAvatarBubble
                        name={actor.name}
                        avatar={actor.avatar}
                        userId={actor.user_id}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {eventActivityText(event, actor.name, t)}
                          </div>
                          <div className="shrink-0 text-[11px] text-text-muted">
                            {new Date(event.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                        {track ? (
                          <div className="jam-dark-surface mt-2 flex items-center gap-2 rounded-xl p-2">
                            {track.albumCover ? (
                              <CrateImage
                                src={track.albumCover}
                                alt=""
                                className="h-9 w-9 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="jam-artwork-placeholder flex h-9 w-9 items-center justify-center rounded-lg">
                                <ListMusic size={14} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-text-primary">
                                {track.title}
                              </div>
                              <div className="truncate text-[11px] text-text-muted">
                                {track.artist}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            {room.events.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("jam.room.noEvents")}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {deleteRoomModal}

      <AppModal
        open={metadataModalOpen}
        onClose={() => setMetadataModalOpen(false)}
        maxWidthClassName="sm:max-w-lg"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("jam.room.profileModalTitle")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("jam.room.profileModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setMetadataModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-text-muted">
                {t("jam.room.descriptionLabel")}
              </span>
              <textarea
                value={metadataDescription}
                onChange={(event) => setMetadataDescription(event.target.value)}
                rows={4}
                placeholder={t("jam.room.descriptionPlaceholder")}
                className="jam-input mt-2 w-full resize-none rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-muted">
                {t("jam.room.tagsLabel")}
              </span>
              <input
                value={metadataTagsInput}
                onChange={(event) => setMetadataTagsInput(event.target.value)}
                placeholder={t("jam.room.tagsPlaceholder")}
                className="jam-input mt-2 h-11 w-full rounded-lg px-4 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetadataModalOpen(false)}
                className="jam-secondary-action rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveRoomMetadata()}
                disabled={updatingRoomField === "metadata"}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground hover:bg-accent-action/90 transition-colors disabled:opacity-60"
              >
                {updatingRoomField === "metadata" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ListMusic size={15} />
                )}
                {t("jam.room.saveProfile")}
              </button>
            </div>
          </div>
        </ModalBody>
      </AppModal>

      <AppModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        maxWidthClassName="sm:max-w-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("jam.room.inviteModalTitle")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("jam.room.inviteModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setInviteModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          {inviteLink ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QrCodeImage
                  value={inviteLink}
                  size={210}
                  className="jam-qr-surface rounded-xl p-3"
                />
              </div>
              <div className="jam-input rounded-lg px-4 py-3 text-xs text-text-muted break-all">
                {inviteLink}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteLink)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground hover:bg-accent-action/90 transition-colors"
                >
                  <Copy size={15} />
                  {t("jam.room.copyLink")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyInviteLink(inviteLink);
                    setInviteModalOpen(false);
                  }}
                  className="jam-secondary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
                >
                  <QrCode size={15} />
                  {t("jam.room.done")}
                </button>
              </div>
            </div>
          ) : null}
        </ModalBody>
      </AppModal>
    </div>
  );
}
