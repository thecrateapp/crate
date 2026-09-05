import { type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Globe2,
  Loader2,
  Lock,
  Pin,
  Radio,
  Search,
  Users,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import type { AuthUser } from "@/contexts/auth-context";
import { JamRoomCard } from "@/components/jam/JamRoomCard";
import { extractInviteToken } from "@/pages/jam-session-utils";
import type { JamQueueMode, JamRoom, JamVisibility } from "@/pages/jam-reducer";

type SelectedGenre = { name: string; slug: string };
type GenreTaxonomyNode = {
  slug: string;
  name: string;
  alias_names?: string[];
};

export function JamLobbyView({
  roomName,
  setRoomName,
  roomDescription,
  setRoomDescription,
  roomTagsInput,
  setRoomTagsInput,
  roomQueueMode,
  onRoomQueueModeChange,
  roomGenreFiltersInput,
  setRoomGenreFiltersInput,
  genreSuggestionIndex,
  setGenreSuggestionIndex,
  selectedGenreItems,
  removeGenre,
  genreSuggestions,
  taxonomyLoading,
  selectGenre,
  roomAutoDjVoting,
  setRoomAutoDjVoting,
  roomVisibility,
  setRoomVisibility,
  roomPermanent,
  setRoomPermanent,
  creating,
  onCreateRoom,
  inviteInput,
  setInviteInput,
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
  deleteRoomModal,
}: {
  roomName: string;
  setRoomName: (value: string) => void;
  roomDescription: string;
  setRoomDescription: (value: string) => void;
  roomTagsInput: string;
  setRoomTagsInput: (value: string) => void;
  roomQueueMode: JamQueueMode;
  onRoomQueueModeChange: (value: JamQueueMode) => void;
  roomGenreFiltersInput: string;
  setRoomGenreFiltersInput: (value: string) => void;
  genreSuggestionIndex: number;
  setGenreSuggestionIndex: Dispatch<SetStateAction<number>>;
  selectedGenreItems: SelectedGenre[];
  removeGenre: (slug: string) => void;
  genreSuggestions: GenreTaxonomyNode[];
  taxonomyLoading: boolean;
  selectGenre: (node: GenreTaxonomyNode) => void;
  roomAutoDjVoting: boolean;
  setRoomAutoDjVoting: (value: boolean) => void;
  roomVisibility: JamVisibility;
  setRoomVisibility: (value: JamVisibility) => void;
  roomPermanent: boolean;
  setRoomPermanent: (value: boolean) => void;
  creating: boolean;
  onCreateRoom: () => void;
  inviteInput: string;
  setInviteInput: (value: string) => void;
  roomsLoading: boolean;
  roomSearch: string;
  setRoomSearch: (value: string) => void;
  memberRooms: JamRoom[];
  publicRooms: JamRoom[];
  user: AuthUser | null;
  joiningRoomId: string | null;
  deletingRoomId: string | null;
  onJoinRoom: (room: JamRoom) => void;
  onDeleteRoom: (room: JamRoom) => void;
  deleteRoomModal: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      <div className="space-y-6">
        <div className="jam-lobby-header rounded-[12px] p-5 sm:p-6">
          <h1 className="text-3xl font-bold text-text-primary">
            {t("jam.lobby.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {t("jam.lobby.subtitle")}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
          <section className="jam-panel rounded-[12px] p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-text-primary">
              {t("jam.lobby.startTitle")}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {t("jam.lobby.startSubtitle")}
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder={t("jam.lobby.namePlaceholder")}
                className="jam-input h-11 w-full rounded-lg px-4 text-sm text-text-primary"
              />
              <textarea
                value={roomDescription}
                onChange={(event) => setRoomDescription(event.target.value)}
                placeholder={t("jam.lobby.descriptionPlaceholder")}
                rows={3}
                className="jam-input w-full resize-none rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted"
              />
              <input
                value={roomTagsInput}
                onChange={(event) => setRoomTagsInput(event.target.value)}
                placeholder={t("jam.lobby.tagsPlaceholder")}
                className="jam-input h-11 w-full rounded-lg px-4 text-sm text-text-primary placeholder:text-text-muted"
              />
              <label className="flex flex-col gap-2 text-sm text-text-primary">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  {t("jam.lobby.playbackMode")}
                </span>
                <Select
                  value={roomQueueMode}
                  onValueChange={(value) => {
                    const nextMode = value as JamQueueMode;
                    onRoomQueueModeChange(nextMode);
                    if (nextMode === "auto_dj") setRoomPermanent(true);
                  }}
                >
                  <SelectTrigger
                    aria-label={t("jam.lobby.playbackMode")}
                    className="jam-select-trigger h-11 w-full px-4"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      {t("jam.room.djMode")}
                    </SelectItem>
                    <SelectItem value="auto">
                      {t("jam.room.autoMode")}
                    </SelectItem>
                    <SelectItem value="auto_dj">
                      {t("jam.room.autoDjMode")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {roomQueueMode === "auto_dj" ? (
                <>
                  <div className="space-y-2">
                    <div className="relative">
                      <div className="jam-tag-input flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5">
                        {selectedGenreItems.map((item) => (
                          <GenrePill
                            key={item.slug}
                            item={item}
                            onRemove={() => removeGenre(item.slug || "")}
                            removeLabel={t("jam.lobby.removeGenreFilter", {
                              genre: item.name,
                            })}
                          />
                        ))}
                        <Search
                          size={16}
                          className="ml-1 shrink-0 text-text-muted"
                        />
                        <input
                          role="combobox"
                          aria-label={t("jam.lobby.genreFiltersPlaceholder")}
                          aria-expanded={Boolean(roomGenreFiltersInput.trim())}
                          aria-controls="jam-genre-taxonomy-options"
                          aria-autocomplete="list"
                          value={roomGenreFiltersInput}
                          onChange={(event) => {
                            setRoomGenreFiltersInput(event.target.value);
                            setGenreSuggestionIndex(0);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ArrowDown" &&
                              genreSuggestions.length
                            ) {
                              event.preventDefault();
                              setGenreSuggestionIndex(
                                (current) =>
                                  (current + 1) % genreSuggestions.length,
                              );
                            } else if (
                              event.key === "ArrowUp" &&
                              genreSuggestions.length
                            ) {
                              event.preventDefault();
                              setGenreSuggestionIndex(
                                (current) =>
                                  (current - 1 + genreSuggestions.length) %
                                  genreSuggestions.length,
                              );
                            } else if (
                              event.key === "Enter" &&
                              genreSuggestions[genreSuggestionIndex]
                            ) {
                              event.preventDefault();
                              selectGenre(
                                genreSuggestions[genreSuggestionIndex],
                              );
                            } else if (event.key === "Escape") {
                              setRoomGenreFiltersInput("");
                            }
                          }}
                          placeholder={t("jam.lobby.genreFiltersPlaceholder")}
                          className="h-8 min-w-[12rem] flex-1 bg-transparent px-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
                        />
                      </div>
                      {roomGenreFiltersInput.trim() ? (
                        <div
                          id="jam-genre-taxonomy-options"
                          role="listbox"
                          className="jam-taxonomy-options absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg p-1 shadow-2xl"
                        >
                          {taxonomyLoading ? (
                            <div className="px-3 py-2 text-xs text-text-muted">
                              {t("jam.lobby.genreFiltersLoading")}
                            </div>
                          ) : genreSuggestions.length ? (
                            genreSuggestions.map((node, index) => (
                              <button
                                key={node.slug}
                                type="button"
                                role="option"
                                aria-selected={index === genreSuggestionIndex}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectGenre(node)}
                                className="jam-taxonomy-option flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
                                data-active={
                                  index === genreSuggestionIndex
                                    ? "true"
                                    : "false"
                                }
                              >
                                <span className="truncate">{node.name}</span>
                                <span className="ml-3 shrink-0 text-xs text-text-muted">
                                  {node.slug}
                                </span>
                              </button>
                            ))
                          ) : (
                            <div
                              role="status"
                              className="px-3 py-2 text-xs text-text-muted"
                            >
                              {t("jam.lobby.genreFiltersNoResults")}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <p className="text-xs text-text-muted">
                      {t("jam.lobby.genreFiltersHint")}
                    </p>
                  </div>
                  <label className="jam-toggle-card flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
                    <span>{t("jam.lobby.autoDjVoting")}</span>
                    <input
                      type="checkbox"
                      checked={roomAutoDjVoting}
                      onChange={(event) =>
                        setRoomAutoDjVoting(event.target.checked)
                      }
                      className="h-4 w-4 accent-[var(--accent-action)]"
                    />
                  </label>
                </>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setRoomVisibility("private")}
                  className={`jam-toggle-option flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors ${
                    roomVisibility === "private" ? "" : "text-text-muted"
                  }`}
                  data-active={roomVisibility === "private" ? "true" : "false"}
                >
                  <Lock size={15} />
                  {t("jam.visibility.inviteOnly")}
                </button>
                <button
                  type="button"
                  onClick={() => setRoomVisibility("public")}
                  className={`jam-toggle-option flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors ${
                    roomVisibility === "public" ? "" : "text-text-muted"
                  }`}
                  data-active={roomVisibility === "public" ? "true" : "false"}
                >
                  <Globe2 size={15} />
                  {t("jam.visibility.public")}
                </button>
              </div>
              <label className="jam-toggle-option flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
                <span className="inline-flex items-center gap-2">
                  <Pin size={15} className="jam-accent-text" />
                  {t("jam.lobby.permanentRoom")}
                </span>
                <input
                  type="checkbox"
                  checked={roomPermanent}
                  onChange={(event) => setRoomPermanent(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent-action)]"
                />
              </label>
              <Button
                type="button"
                onClick={onCreateRoom}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground hover:bg-accent-action/90 transition-colors disabled:opacity-60"
              >
                {creating ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Radio size={15} />
                )}
                {t("jam.lobby.createRoom")}
              </Button>
            </div>
          </section>

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
                <Loader2
                  size={18}
                  className="animate-spin text-accent-action"
                />
              ) : null}
            </div>

            <div className="jam-input mt-4 flex items-center gap-2 rounded-lg px-3 py-2">
              <Search size={15} className="text-text-muted" />
              <input
                value={roomSearch}
                onChange={(event) => setRoomSearch(event.target.value)}
                placeholder={t("jam.lobby.searchPlaceholder")}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>

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
        </div>

        <section className="jam-panel rounded-[12px] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.lobby.joinInviteTitle")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("jam.lobby.joinInviteSubtitle")}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={inviteInput}
              onChange={(event) => setInviteInput(event.target.value)}
              placeholder={t("jam.lobby.invitePlaceholder")}
              className="jam-input h-11 min-w-0 flex-1 rounded-lg px-4 text-sm text-text-primary"
            />
            <button
              type="button"
              onClick={() => {
                const token = extractInviteToken(inviteInput);
                if (!token) {
                  toast.error(t("jam.toasts.invalidInvite"));
                  return;
                }
                navigate(`/jam/invite/${token}`);
              }}
              className="jam-secondary-action inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
            >
              <Users size={15} />
              {t("jam.lobby.joinRoom")}
            </button>
          </div>
        </section>
      </div>
      {deleteRoomModal}
    </>
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
