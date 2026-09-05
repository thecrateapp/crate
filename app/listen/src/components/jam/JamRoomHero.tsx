import {
  type ButtonHTMLAttributes,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Globe2,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  Radio,
  Share2,
  SkipForward,
  Trash2,
  Zap,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { Button } from "@crate/ui/shadcn/button";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/PlayerContext";
import { formatDuration } from "@/lib/utils";
import type { JamQueueItem, JamQueueMode, JamRoom } from "@/pages/jam-reducer";

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

type RoomUpdateField = "visibility" | "permanent" | "metadata" | "queue_mode";

type UpdateRoomSettings = (
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
  field: RoomUpdateField,
) => Promise<boolean>;

export interface JamRoomHeroProps {
  t: TFunction;
  room: JamRoom;
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
  updatingRoomField: RoomUpdateField | null;
  updateRoomSettings: UpdateRoomSettings;
  openMetadataModal: () => void;
  handleCreateInvite: () => void | Promise<void>;
  creatingInvite: boolean;
  handleEndRoom: () => void | Promise<void>;
  endingRoom: boolean;
  requestDeleteRoom: (room: JamRoom) => void;
  deletingRoomId: string | null;
}

export interface JamRoomHeroProps {
  t: TFunction;
  room: JamRoom;
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
  updatingRoomField: RoomUpdateField | null;
  updateRoomSettings: UpdateRoomSettings;
  openMetadataModal: () => void;
  handleCreateInvite: () => void | Promise<void>;
  creatingInvite: boolean;
  handleEndRoom: () => void | Promise<void>;
  endingRoom: boolean;
  requestDeleteRoom: (room: JamRoom) => void;
  deletingRoomId: string | null;
}

type JamRoomHeaderProps = Pick<
  JamRoomHeroProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
  | "isHost"
  | "currentTrackAlreadyQueued"
  | "queuePrimaryActionLabel"
  | "shareCurrentTrack"
  | "handlePlayRoomQueue"
  | "queueItems"
  | "roomActionsOpen"
  | "setRoomActionsOpen"
>;

type JamNowPlayingProps = Pick<
  JamRoomHeroProps,
  | "t"
  | "roomNowPlaying"
  | "currentTime"
  | "duration"
  | "isHost"
  | "isPlaying"
  | "toggleRoomPlayback"
  | "handlePlayNext"
  | "syncStatus"
  | "syncPlaybackState"
  | "roomIsActive"
  | "isConnected"
  | "queueItems"
>;

type JamRoomActionsProps = Pick<
  JamRoomHeroProps,
  | "t"
  | "room"
  | "roomActionsOpen"
  | "isHost"
  | "updatingRoomField"
  | "roomIsActive"
  | "updateRoomSettings"
  | "openMetadataModal"
  | "handleCreateInvite"
  | "creatingInvite"
  | "handleEndRoom"
  | "endingRoom"
  | "requestDeleteRoom"
  | "deletingRoomId"
>;

type JamRoomIdentityProps = Pick<
  JamRoomHeaderProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
>;

type JamRoomHeaderActionsProps = Pick<
  JamRoomHeaderProps,
  | "t"
  | "isConnected"
  | "roomIsActive"
  | "isHost"
  | "currentTrackAlreadyQueued"
  | "queuePrimaryActionLabel"
  | "shareCurrentTrack"
  | "handlePlayRoomQueue"
  | "queueItems"
  | "roomActionsOpen"
  | "setRoomActionsOpen"
>;

type JamNowPlayingTrackProps = Pick<
  JamNowPlayingProps,
  "t" | "roomNowPlaying" | "currentTime" | "duration"
>;

type JamPlaybackControlsProps = Pick<
  JamNowPlayingProps,
  | "t"
  | "isHost"
  | "isPlaying"
  | "toggleRoomPlayback"
  | "handlePlayNext"
  | "syncStatus"
  | "syncPlaybackState"
  | "roomIsActive"
  | "isConnected"
  | "roomNowPlaying"
  | "queueItems"
>;

type JamRoomMetaBadgesProps = Pick<
  JamRoomIdentityProps,
  "t" | "room" | "queueMode"
>;

type JamRoomConnectionBadgesProps = Pick<
  JamRoomIdentityProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
>;

function JamRoomMetaBadges({ t, room, queueMode }: JamRoomMetaBadgesProps) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2.5">
      <h1 className="text-3xl font-bold text-text-primary">{room.name}</h1>
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
  );
}

function JamRoomConnectionBadges(props: JamRoomConnectionBadgesProps) {
  const { t, room, queueMode, isConnected, connectionProblem, roomIsActive } =
    props;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {isConnected ? (
        <div className="jam-success-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          <Radio size={12} className="jam-success-text" />
          {t("jam.room.connected")}
        </div>
      ) : (
        <div className="jam-warning-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          {connectionProblem && !connectionProblem.includes("Retrying") ? (
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
      {queueMode === "auto_dj" && (room.genre_filters || []).length ? (
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
  );
}

function JamRoomIdentity(props: JamRoomIdentityProps) {
  const { t, room } = props;

  return (
    <div className="min-w-0">
      <div className="jam-accent-text text-xs uppercase tracking-wide">
        {t("jam.room.eyebrow")}
      </div>
      <JamRoomMetaBadges {...props} />
      <p className="mt-2 max-w-2xl text-sm text-text-muted">
        {room.description ||
          t("jam.room.defaultDescription", {
            count: room.members.length,
          })}
      </p>
      <JamRoomConnectionBadges {...props} />
    </div>
  );
}

function JamRoomHeaderActions(props: JamRoomHeaderActionsProps) {
  const {
    t,
    isConnected,
    roomIsActive,
    isHost,
    currentTrackAlreadyQueued,
    queuePrimaryActionLabel,
    shareCurrentTrack,
    handlePlayRoomQueue,
    queueItems,
    roomActionsOpen,
    setRoomActionsOpen,
  } = props;

  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      <HeroPrimaryButton
        label={queuePrimaryActionLabel}
        onClick={shareCurrentTrack}
        disabled={!roomIsActive || !isConnected || currentTrackAlreadyQueued}
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
  );
}

function JamRoomHeader(props: JamRoomHeaderProps) {
  return (
    <>
      <JamRoomIdentity {...props} />
      <JamRoomHeaderActions {...props} />
    </>
  );
}

function JamNowPlayingTrack(props: JamNowPlayingTrackProps) {
  const { t, roomNowPlaying, currentTime, duration } = props;

  return (
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
                    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
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
  );
}

type JamHostPlaybackControlsProps = Pick<
  JamPlaybackControlsProps,
  | "t"
  | "isPlaying"
  | "toggleRoomPlayback"
  | "handlePlayNext"
  | "syncStatus"
  | "syncPlaybackState"
  | "roomIsActive"
  | "isConnected"
  | "roomNowPlaying"
  | "queueItems"
>;

function JamHostPlaybackControls({
  t,
  isPlaying,
  toggleRoomPlayback,
  handlePlayNext,
  syncStatus,
  syncPlaybackState,
  roomIsActive,
  isConnected,
  roomNowPlaying,
  queueItems,
}: JamHostPlaybackControlsProps) {
  return (
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
        disabled={!roomIsActive || !isConnected || queueItems.length === 0}
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
  );
}

function JamGuestPlaybackStatus({
  t,
  syncStatus,
}: Pick<JamPlaybackControlsProps, "t" | "syncStatus">) {
  return (
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
  );
}

function JamPlaybackControls(props: JamPlaybackControlsProps) {
  const { isHost } = props;

  return (
    <div className="flex items-center gap-2 md:justify-end">
      {isHost ? (
        <JamHostPlaybackControls {...props} />
      ) : (
        <JamGuestPlaybackStatus {...props} />
      )}
    </div>
  );
}

function JamNowPlaying(props: JamNowPlayingProps) {
  return (
    <div className="jam-now-playing grid min-w-0 gap-4 rounded-xl p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
      <JamNowPlayingTrack {...props} />
      <JamPlaybackControls {...props} />
    </div>
  );
}

function JamRoomActions(props: JamRoomActionsProps) {
  const {
    t,
    room,
    roomActionsOpen,
    isHost,
    updatingRoomField,
    roomIsActive,
    updateRoomSettings,
    openMetadataModal,
    handleCreateInvite,
    creatingInvite,
    handleEndRoom,
    endingRoom,
    requestDeleteRoom,
    deletingRoomId,
  } = props;

  return (
    <>
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
    </>
  );
}

export function JamRoomHero(props: JamRoomHeroProps) {
  return (
    <div className="jam-room-header rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-5">
        <JamRoomHeader {...props} />
        <JamNowPlaying {...props} />
        <JamRoomActions {...props} />
      </div>
    </div>
  );
}
