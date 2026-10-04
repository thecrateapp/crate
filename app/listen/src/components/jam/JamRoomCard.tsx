import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  CRATE_ICON_SIZE,
  Globe2,
  Loader2,
  Lock,
  Pin,
  Trash2,
  Users,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { buildJamRoomActions } from "@/components/actions/jam-actions";

import type { AuthUser } from "@/contexts/auth-context";
import { type JamRoom } from "@/pages/jam-reducer";
import {
  displayName,
  eventActivityText,
  resolveJamActor,
} from "@/pages/jam-session-utils";

import { JamAvatarBubble } from "./JamAvatarBubble";

export const JamRoomCard = memo(function JamRoomCard({
  listedRoom,
  mode,
  user,
  joining,
  deleting,
  onJoin,
  onDelete,
  t,
}: {
  listedRoom: JamRoom;
  mode: "member" | "public";
  user: AuthUser | null;
  joining: boolean;
  deleting: boolean;
  onJoin: (room: JamRoom) => void;
  onDelete: (room: JamRoom) => void;
  t: TFunction;
}) {
  const isMember =
    listedRoom.is_member ??
    listedRoom.members.some((member) => member.user_id === user?.id);
  const isHostRoom = listedRoom.host_user_id === user?.id;
  const events = listedRoom.events || [];
  const latestEvent = events[events.length - 1];
  const latestActor = latestEvent
    ? resolveJamActor(latestEvent, listedRoom.members, user)
    : null;

  const latest = useRef({ listedRoom, onJoin, onDelete });
  useEffect(() => {
    latest.current = { listedRoom, onJoin, onDelete };
  });
  const getActions = useCallback(
    () =>
      buildJamRoomActions(
        {
          isMember,
          isHost: isHostRoom,
          joining,
          deleting,
          onJoin: () => latest.current.onJoin(latest.current.listedRoom),
          onDelete: () => latest.current.onDelete(latest.current.listedRoom),
        },
        t,
      ),
    [deleting, isHostRoom, isMember, joining, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: listedRoom.name,
      subtitle: t("jam.roomCard.memberCount", {
        count: listedRoom.member_count || listedRoom.members.length,
      }),
      imageUrl: null,
      imageAlt: listedRoom.name,
      imageShape: "square",
      fallbackIcon: Users,
    }),
    [listedRoom.member_count, listedRoom.members.length, listedRoom.name, t],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });

  return (
    <article className="item-action-target group relative" {...targetProps}>
      <button
        type="button"
        aria-label={
          isMember
            ? t("jam.roomCard.openAria", { name: listedRoom.name })
            : t("jam.roomCard.joinAria", { name: listedRoom.name })
        }
        onClick={() => onJoin(listedRoom)}
        className="jam-card-interactive block w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <RoomCardHeader room={listedRoom} mode={mode} joining={joining} t={t} />
        <RoomCardMembers room={listedRoom} t={t} />
        {latestEvent ? (
          <span className="mt-3 block truncate text-xs text-text-muted">
            {eventActivityText(latestEvent, latestActor?.name, t)}
          </span>
        ) : null}
      </button>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
        <ItemActionMenuButton
          buttonRef={controller.triggerRef}
          hasActions={controller.hasActions}
          onClick={controller.openFromTrigger}
          expanded={controller.open}
          title={t("actions.menu.more")}
          className="size-9 rounded-full opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
        />
        {isHostRoom ? (
          <RoomCardDeleteButton
            room={listedRoom}
            deleting={deleting}
            onDelete={onDelete}
            t={t}
          />
        ) : null}
      </div>
      {menu}
    </article>
  );
});

function RoomCardHeader({
  room,
  mode,
  joining,
  t,
}: {
  room: JamRoom;
  mode: "member" | "public";
  joining: boolean;
  t: TFunction;
}) {
  return (
    <span className="flex items-start justify-between gap-3">
      <span className="block min-w-0">
        <span className="block truncate text-base font-semibold text-text-primary">
          {room.name}
        </span>
        {room.description ? (
          <span className="block mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
            {room.description}
          </span>
        ) : null}
        <RoomCardBadges room={room} mode={mode} t={t} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2 pr-20">
        <span className="jam-chip flex size-9 items-center justify-center rounded-full text-text-muted">
          {joining ? (
            <Loader2 size={15} className="jam-accent-text animate-spin" />
          ) : (
            <Users size={15} />
          )}
        </span>
      </span>
    </span>
  );
}

function RoomCardBadges({
  room,
  mode,
  t,
}: {
  room: JamRoom;
  mode: "member" | "public";
  t: TFunction;
}) {
  return (
    <span className="mt-2 flex flex-wrap gap-1.5 text-xs">
      <span className="jam-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-text-muted">
        {room.visibility === "public" ? (
          <Globe2 size={11} />
        ) : (
          <Lock size={11} />
        )}
        {mode === "member"
          ? t("jam.roomCard.yourRoom")
          : t("jam.visibility.public")}
      </span>
      {room.is_permanent ? (
        <span className="jam-accent-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
          <Pin size={11} />
          {t("jam.roomCard.permanent")}
        </span>
      ) : null}
      {room.status !== "active" ? (
        <span className="jam-warning-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
          {t("jam.roomCard.paused")}
        </span>
      ) : null}
      {(room.tags || []).slice(0, 5).map((tag) => (
        <span
          key={`${room.id}-${tag}`}
          className="jam-chip rounded-full px-2 py-0.5 text-text-muted"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

function RoomCardMembers({ room, t }: { room: JamRoom; t: TFunction }) {
  return (
    <span className="mt-4 flex items-center justify-between gap-3">
      <span className="flex">
        {room.members.slice(0, 5).map((member, index) => (
          <JamAvatarBubble
            key={`${room.id}-${member.user_id}`}
            name={displayName(member)}
            avatar={member.avatar}
            userId={member.user_id}
            size="sm"
            className={index === 0 ? "" : "-ml-2"}
          />
        ))}
      </span>
      <span className="block text-xs text-text-muted">
        {t("jam.roomCard.memberCount", {
          count: room.member_count || room.members.length,
        })}
      </span>
    </span>
  );
}

function RoomCardDeleteButton({
  room,
  deleting,
  onDelete,
  t,
}: {
  room: JamRoom;
  deleting: boolean;
  onDelete: (room: JamRoom) => void;
  t: TFunction;
}) {
  return (
    <IconButton
      tone="danger"
      onClick={() => onDelete(room)}
      loading={deleting}
      title={t("jam.delete.title")}
      label={t("jam.delete.aria", { name: room.name })}
      className="jam-danger-control size-9 [&_svg:not([class*='size-'])]:size-3.5"
    >
      <Trash2 size={CRATE_ICON_SIZE.xs} />
    </IconButton>
  );
}
