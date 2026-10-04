import { Loader2 } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { AuthUser } from "@/contexts/auth-context";
import { JamRoomCard } from "@/components/jam/JamRoomCard";
import type { JamRoom } from "@/pages/jam-reducer";

import type { JamOpenRoomsPanelProps } from "./jam-lobby-types";

export function JamOpenRoomsPanel({
  roomsLoading,
  roomSearch,
  setRoomSearch,
  memberRooms,
  publicRooms,
  user,
  joiningRoomId,
  deletingRoomId,
  onJoinRoom,
  onDeleteRoom,
}: JamOpenRoomsPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="jam-panel rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.lobby.openRoomsTitle")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("jam.lobby.openRoomsSubtitle")}
          </p>
        </div>
        {roomsLoading ? (
          <Loader2 size={18} className="animate-spin text-accent-action" />
        ) : null}
      </div>

      <SearchInput
        value={roomSearch}
        onValueChange={setRoomSearch}
        label={t("jam.lobby.searchPlaceholder")}
        clearLabel={t("common.clear")}
        placeholder={t("jam.lobby.searchPlaceholder")}
        containerClassName="mt-4"
        className="jam-input h-12 rounded-lg shadow-none backdrop-blur-none placeholder:text-text-muted md:text-base"
      />

      <div className="mt-5 space-y-6">
        <RoomList
          rooms={memberRooms}
          title={t("jam.lobby.yourRooms")}
          emptyLabel={t("jam.lobby.emptyMemberRooms")}
          mode="member"
          roomsLoading={roomsLoading}
          user={user}
          joiningRoomId={joiningRoomId}
          deletingRoomId={deletingRoomId}
          onJoinRoom={onJoinRoom}
          onDeleteRoom={onDeleteRoom}
          t={t}
        />
        <RoomList
          rooms={publicRooms}
          title={t("jam.lobby.publicRooms")}
          emptyLabel={t("jam.lobby.emptyPublicRooms")}
          mode="public"
          roomsLoading={roomsLoading}
          user={user}
          joiningRoomId={joiningRoomId}
          deletingRoomId={deletingRoomId}
          onJoinRoom={onJoinRoom}
          onDeleteRoom={onDeleteRoom}
          t={t}
        />
      </div>
    </section>
  );
}

function RoomList({
  rooms,
  title,
  emptyLabel,
  mode,
  roomsLoading,
  user,
  joiningRoomId,
  deletingRoomId,
  onJoinRoom,
  onDeleteRoom,
  t,
}: {
  rooms: JamRoom[];
  title: string;
  emptyLabel: string;
  mode: "member" | "public";
  roomsLoading: boolean;
  user: AuthUser | null;
  joiningRoomId: string | null;
  deletingRoomId: string | null;
  onJoinRoom: (room: JamRoom) => void;
  onDeleteRoom: (room: JamRoom) => void;
  t: TFunction;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <span className="text-xs text-text-muted">{rooms.length}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rooms.map((room) => (
          <JamRoomCard
            key={room.id}
            listedRoom={room}
            mode={mode}
            user={user}
            joining={joiningRoomId === room.id}
            deleting={deletingRoomId === room.id}
            onJoin={onJoinRoom}
            onDelete={onDeleteRoom}
            t={t}
          />
        ))}
        {!roomsLoading && rooms.length === 0 ? (
          <div className="jam-empty-state rounded-lg p-5 text-sm text-text-muted">
            {emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}
