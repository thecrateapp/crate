import { type Dispatch, type SetStateAction } from "react";
import {
  Globe2,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pin,
  Plus,
  Power,
  Radio,
  Share2,
  Trash2,
  Zap,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import type { Track } from "@/contexts/PlayerContext";
import type { JamQueueItem, JamQueueMode, JamRoom } from "@/pages/jam-reducer";

import { HeroActionButton, HeroPrimaryButton } from "./JamHeroButtons";

export type RoomUpdateField =
  | "visibility"
  | "permanent"
  | "metadata"
  | "queue_mode";

export type UpdateRoomSettings = (
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

export function JamRoomHeader(props: JamRoomHeaderProps) {
  return (
    <>
      <JamRoomIdentity {...props} />
      <JamRoomHeaderActions {...props} />
    </>
  );
}

export function JamRoomActions(props: JamRoomActionsProps) {
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
