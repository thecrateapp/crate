import { Globe2, Loader2, Lock, Pin, Trash2, Users } from "@crate/ui/icons";
import type { TFunction } from "i18next";

import type { AuthUser } from "@/contexts/auth-context";
import { type JamRoom } from "@/pages/jam-reducer";
import {
  displayName,
  eventActivityText,
  resolveJamActor,
} from "@/pages/jam-session-utils";

import { JamAvatarBubble } from "./JamAvatarBubble";

export function JamRoomCard({
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
  const latestEvent = [...(listedRoom.events || [])].reverse()[0];
  const latestActor = latestEvent
    ? resolveJamActor(latestEvent, listedRoom.members, user)
    : null;

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-label={
          isMember
            ? t("jam.roomCard.openAria", { name: listedRoom.name })
            : t("jam.roomCard.joinAria", { name: listedRoom.name })
        }
        onClick={() => onJoin(listedRoom)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onJoin(listedRoom);
          }
        }}
        className="jam-card-interactive cursor-pointer rounded-xl p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-text-primary">
              {listedRoom.name}
            </div>
            {listedRoom.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                {listedRoom.description}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="jam-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-text-muted">
                {listedRoom.visibility === "public" ? (
                  <Globe2 size={11} />
                ) : (
                  <Lock size={11} />
                )}
                {mode === "member"
                  ? t("jam.roomCard.yourRoom")
                  : t("jam.visibility.public")}
              </span>
              {listedRoom.is_permanent ? (
                <span className="jam-accent-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                  <Pin size={11} />
                  {t("jam.roomCard.permanent")}
                </span>
              ) : null}
              {listedRoom.status !== "active" ? (
                <span className="jam-warning-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                  {t("jam.roomCard.paused")}
                </span>
              ) : null}
              {(listedRoom.tags || []).slice(0, 5).map((tag) => (
                <span
                  key={`${listedRoom.id}-${tag}`}
                  className="jam-chip rounded-full px-2 py-0.5 text-text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 pr-12">
            <div className="jam-chip flex h-9 w-9 items-center justify-center rounded-full text-text-muted">
              {joining ? (
                <Loader2 size={15} className="jam-accent-text animate-spin" />
              ) : (
                <Users size={15} />
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex -space-x-2">
            {listedRoom.members.slice(0, 5).map((member) => (
              <JamAvatarBubble
                key={`${listedRoom.id}-${member.user_id}`}
                name={displayName(member)}
                avatar={member.avatar}
                userId={member.user_id}
                size="sm"
              />
            ))}
          </div>
          <div className="text-xs text-text-muted">
            {t("jam.roomCard.memberCount", {
              count: listedRoom.member_count || listedRoom.members.length,
            })}
          </div>
        </div>
        {latestEvent ? (
          <div className="mt-3 truncate text-xs text-text-muted">
            {eventActivityText(latestEvent, latestActor?.name, t)}
          </div>
        ) : null}
      </div>
      {isHostRoom ? (
        <button
          type="button"
          onClick={() => onDelete(listedRoom)}
          disabled={deleting}
          title={t("jam.delete.title")}
          aria-label={t("jam.delete.aria", { name: listedRoom.name })}
          className="jam-danger-control absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
        </button>
      ) : null}
    </div>
  );
}
