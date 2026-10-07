import {
  CRATE_ICON_SIZE,
  Globe2,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pin,
  Plus,
  Radio,
  Zap,
  Pause,
  Tag,
} from "@crate/ui/icons";

import type { JamRoomHeroProps } from "./JamRoomHeroSections";
import { HeroActionButton, HeroPrimaryButton } from "./JamHeroButtons";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

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
      <CrateBadge size="md" icon={Zap}>
        {queueMode === "auto_dj"
          ? t("jam.room.autoDjMode")
          : queueMode === "auto"
            ? t("jam.room.autoMode")
            : t("jam.room.djMode")}
      </CrateBadge>
      <CrateBadge size="md" icon={room.visibility === "public" ? Globe2 : Lock}>
        {room.visibility === "public"
          ? t("jam.room.publicRoom")
          : t("jam.visibility.inviteOnly")}
      </CrateBadge>
      {room.is_permanent ? (
        <CrateBadge size="md" icon={Pin}>
          {t("jam.roomCard.permanent")}
        </CrateBadge>
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
        <CrateBadge size="md" icon={Radio} tone="success">
          {t("jam.room.connected")}
        </CrateBadge>
      ) : (
        <CrateBadge
          size="md"
          icon={
            connectionProblem && !connectionProblem.includes("Retrying")
              ? Radio
              : Loader2
          }
          iconClassName={
            connectionProblem && !connectionProblem.includes("Retrying")
              ? undefined
              : "animate-spin"
          }
          tone="warning"
        >
          {connectionProblem || t("jam.room.connecting")}
        </CrateBadge>
      )}
      {!roomIsActive ? (
        <CrateBadge size="md" icon={Pause} tone="warning">
          {t("jam.room.ended")}
        </CrateBadge>
      ) : null}
      {queueMode === "auto_dj" && (room.genre_filters || []).length ? (
        <CrateBadge size="md" icon={Tag} tone="info">
          {t("jam.room.autoDjGenres", {
            genres: (room.genre_filters || []).join(", "),
          })}
        </CrateBadge>
      ) : null}
      {(room.tags || []).map((tag) => (
        <CrateBadge key={tag} size="md">
          {tag}
        </CrateBadge>
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
        <Plus size={CRATE_ICON_SIZE.md} />
      </HeroPrimaryButton>
      <HeroPrimaryButton
        label={t("jam.room.actions.playRoomQueue")}
        onClick={handlePlayRoomQueue}
        disabled={queueItems.length === 0 || !isHost || !isConnected}
      >
        <ListMusic size={CRATE_ICON_SIZE.md} />
      </HeroPrimaryButton>
      {isHost ? (
        <HeroActionButton
          label={t("jam.room.actions.roomSettings")}
          aria-expanded={roomActionsOpen}
          onClick={() => setRoomActionsOpen((open) => !open)}
          className={roomActionsOpen ? "jam-accent-chip" : ""}
        >
          <MoreHorizontal size={CRATE_ICON_SIZE.md} />
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
