import { type ComponentProps, type ReactNode, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListMusic,
  Loader2,
  Search,
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

import { CrateImage } from "@/components/artwork/CrateImage";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { Button } from "@crate/ui/shadcn/button";
import type { Track } from "@/contexts/PlayerContext";
import {
  type JamQueueItem,
  type JamQueueMode,
  type JamRoom,
  type SearchTrack,
} from "@/pages/jam-reducer";
import { searchTrackToTrack, trackIdentity } from "@/pages/jam-session-utils";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";

const jamQueueItemClassName =
  "jam-queue-item flex items-center gap-3 rounded-lg px-3 py-3";

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

export interface JamQueuePanelProps {
  t: TFunction;
  room: JamRoom;
  queueMode: JamQueueMode;
  isHost: boolean;
  queueItems: JamQueueItem[];
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  roomIsActive: boolean;
  toggleQueueMode: () => void;
  enableAutoDj: () => void;
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
  canManageQueue: boolean;
  canAddToQueue: boolean;
  isConnected: boolean;
  handleVote: (item: JamQueueItem) => void;
  handleMoveInRoomQueue: (
    queueItemId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  handleRemoveFromRoomQueue: (queueItemId: string) => void;
  focusQueueSearch: () => void;
  queuePrimaryActionLabel: string;
}

type JamQueueToolbarProps = Pick<
  JamQueuePanelProps,
  | "t"
  | "queueMode"
  | "isHost"
  | "queueItems"
  | "updatingRoomField"
  | "roomIsActive"
  | "toggleQueueMode"
  | "enableAutoDj"
  | "autoDjSuggestions"
  | "queueSearchInputRef"
  | "queueSearch"
  | "setQueueSearch"
  | "canEditQueue"
  | "queueSearchLoading"
  | "queueSearchResults"
  | "addSearchTrackToRoom"
  | "canAddToQueue"
>;

type JamQueueListProps = Pick<
  JamQueuePanelProps,
  | "t"
  | "room"
  | "queueMode"
  | "queueItems"
  | "queueSensors"
  | "handleQueueDragEnd"
  | "canManageQueue"
  | "isConnected"
  | "handleVote"
  | "handleMoveInRoomQueue"
  | "handleRemoveFromRoomQueue"
  | "focusQueueSearch"
  | "queuePrimaryActionLabel"
>;

type JamQueueHeaderProps = Pick<
  JamQueueToolbarProps,
  "t" | "queueMode" | "queueItems"
>;

type JamQueueModeControlsProps = Pick<
  JamQueueToolbarProps,
  | "t"
  | "queueMode"
  | "isHost"
  | "updatingRoomField"
  | "roomIsActive"
  | "toggleQueueMode"
  | "enableAutoDj"
>;

type JamAutoDjSuggestionsProps = Pick<
  JamQueueToolbarProps,
  "t" | "queueMode" | "autoDjSuggestions"
>;

type JamQueueSearchProps = Pick<
  JamQueueToolbarProps,
  | "t"
  | "queueItems"
  | "queueSearchInputRef"
  | "queueSearch"
  | "setQueueSearch"
  | "canEditQueue"
  | "queueSearchLoading"
  | "queueSearchResults"
  | "addSearchTrackToRoom"
  | "canAddToQueue"
>;

function JamQueueHeader({ t, queueMode, queueItems }: JamQueueHeaderProps) {
  return (
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
  );
}

function JamQueueModeControls(props: JamQueueModeControlsProps) {
  const {
    t,
    queueMode,
    isHost,
    updatingRoomField,
    roomIsActive,
    toggleQueueMode,
    enableAutoDj,
  } = props;

  return (
    <>
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
    </>
  );
}

function JamAutoDjSuggestions({
  t,
  queueMode,
  autoDjSuggestions,
}: JamAutoDjSuggestionsProps) {
  return (
    <>
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
    </>
  );
}

function JamQueueSearch(props: JamQueueSearchProps) {
  const {
    t,
    queueItems,
    queueSearchInputRef,
    queueSearch,
    setQueueSearch,
    canEditQueue,
    queueSearchLoading,
    queueSearchResults,
    addSearchTrackToRoom,
    canAddToQueue,
  } = props;

  return (
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
          <Loader2 size={15} className="animate-spin text-accent-action" />
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
  );
}

function JamQueueToolbar(props: JamQueueToolbarProps) {
  return (
    <>
      <JamQueueHeader {...props} />
      <JamQueueModeControls {...props} />
      <JamAutoDjSuggestions {...props} />
      <JamQueueSearch {...props} />
    </>
  );
}

function JamQueueList(props: JamQueueListProps) {
  const {
    t,
    room,
    queueMode,
    queueItems,
    queueSensors,
    handleQueueDragEnd,
    canManageQueue,
    isConnected,
    handleVote,
    handleMoveInRoomQueue,
    handleRemoveFromRoomQueue,
    focusQueueSearch,
    queuePrimaryActionLabel,
  } = props;

  return (
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
                (queueMode !== "auto_dj" || room.auto_dj_voting !== false) ? (
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
            {t("jam.room.emptyQueuePrefix")} <b>{queuePrimaryActionLabel}</b>{" "}
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
  );
}

export function JamQueuePanel(props: JamQueuePanelProps) {
  return (
    <section className="jam-queue-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <JamQueueToolbar {...props} />
      <JamQueueList {...props} />
    </section>
  );
}
