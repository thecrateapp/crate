import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  GripVertical,
  ImagePlus,
  Loader2,
  Music2,
  Search,
  Upload,
  X,
} from "@crate/ui/icons";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { api } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";

export interface PlaylistComposerTrack {
  entityUid?: string;
  globalTrackUid?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  path?: string | null;
  libraryTrackId?: number;
  playlistEntryId?: number;
  playlistPosition?: number;
}

interface SearchTrackResult {
  id?: number | string;
  entity_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  global_uid?: string;
  title: string;
  artist: string;
  album: string;
  path?: string | null;
  duration: number;
}

interface PlaylistCreateModalProps {
  open: boolean;
  mode?: "create" | "edit";
  initialName?: string;
  initialDescription?: string;
  initialCoverDataUrl?: string | null;
  initialVisibility?: "public" | "private";
  initialCollaborative?: boolean;
  initialTracks: PlaylistComposerTrack[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) => Promise<void>;
}

function getTrackKey(track: PlaylistComposerTrack): string {
  if (track.globalTrackUid) return `global:${track.globalTrackUid}`;
  if (track.entityUid) return `entity:${track.entityUid}`;
  if (track.libraryTrackId != null) return `id:${track.libraryTrackId}`;
  if (track.path) return `path:${track.path}`;
  return `${track.artist}:${track.album}:${track.title}`;
}

function searchTrackGlobalUid(track: SearchTrackResult): string | undefined {
  return track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
}

function searchTrackKey(track: SearchTrackResult): string {
  const globalUid = searchTrackGlobalUid(track);
  if (globalUid) return `global:${globalUid}`;
  if (track.entity_uid) return `entity:${track.entity_uid}`;
  if (typeof track.id === "number") return `id:${track.id}`;
  if (track.path) return `path:${track.path}`;
  return `${track.artist}:${track.album}:${track.title}`;
}

function toComposerTrack(track: SearchTrackResult): PlaylistComposerTrack {
  return {
    globalTrackUid: searchTrackGlobalUid(track),
    entityUid: track.entity_uid,
    libraryTrackId: typeof track.id === "number" ? track.id : undefined,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  };
}

function SortableTrackItem({
  track,
  onRemove,
}: {
  track: PlaylistComposerTrack;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getTrackKey(track) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 px-3 py-2.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab text-text-primary/20 hover:text-text-primary/50 touch-none"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-md bg-text-primary/5 flex items-center justify-center flex-shrink-0">
          <Music2 size={15} className="text-text-muted" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-text-primary">
            {track.title}
          </div>
          <div className="truncate text-xs text-text-muted">
            {track.artist}
            {track.album ? ` · ${track.album}` : ""}
            {track.duration ? ` · ${formatDuration(track.duration)}` : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="rounded-full p-1.5 text-text-muted hover:text-text-primary hover:bg-text-primary/5 transition-colors"
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function mergeUniqueTracks(
  tracks: PlaylistComposerTrack[],
): PlaylistComposerTrack[] {
  const seen = new Set<string>();
  const result: PlaylistComposerTrack[] = [];
  for (const track of tracks) {
    const key = getTrackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

type PlaylistComposerState = {
  name: string;
  description: string;
  coverDataUrl: string | null;
  visibility: "public" | "private";
  isCollaborative: boolean;
  tracks: PlaylistComposerTrack[];
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  titleEditing: boolean;
  descriptionEditing: boolean;
};

type PlaylistComposerAction =
  | {
      type: "reset";
      initialName: string;
      initialDescription: string;
      initialCoverDataUrl: string | null;
      initialVisibility: "public" | "private";
      initialCollaborative: boolean;
      initialTracks: PlaylistComposerTrack[];
    }
  | { type: "set-name"; value: string }
  | { type: "set-description"; value: string }
  | { type: "set-cover"; value: string | null }
  | { type: "set-visibility"; value: "public" | "private" }
  | { type: "toggle-collaborative" }
  | { type: "set-tracks"; value: PlaylistComposerTrack[] }
  | { type: "move-track"; activeId: string; overId: string }
  | { type: "add-track"; value: PlaylistComposerTrack }
  | { type: "remove-track"; key: string }
  | { type: "set-search"; value: string }
  | { type: "set-searching"; value: boolean }
  | { type: "set-results"; value: SearchTrackResult[] }
  | { type: "set-title-editing"; value: boolean }
  | { type: "set-description-editing"; value: boolean };

const initialPlaylistComposerState: PlaylistComposerState = {
  name: "",
  description: "",
  coverDataUrl: null,
  visibility: "private",
  isCollaborative: false,
  tracks: [],
  search: "",
  searching: false,
  results: [],
  titleEditing: false,
  descriptionEditing: false,
};

function playlistComposerReducer(
  state: PlaylistComposerState,
  action: PlaylistComposerAction,
): PlaylistComposerState {
  switch (action.type) {
    case "reset":
      return {
        ...initialPlaylistComposerState,
        name: action.initialName,
        description: action.initialDescription,
        coverDataUrl: action.initialCoverDataUrl,
        visibility: action.initialVisibility,
        isCollaborative: action.initialCollaborative,
        tracks: action.initialTracks,
      };
    case "set-name":
      return { ...state, name: action.value };
    case "set-description":
      return { ...state, description: action.value };
    case "set-cover":
      return { ...state, coverDataUrl: action.value };
    case "set-visibility":
      return { ...state, visibility: action.value };
    case "toggle-collaborative":
      return { ...state, isCollaborative: !state.isCollaborative };
    case "set-tracks":
      return { ...state, tracks: action.value };
    case "move-track": {
      const oldIndex = state.tracks.findIndex(
        (track) => getTrackKey(track) === action.activeId,
      );
      const newIndex = state.tracks.findIndex(
        (track) => getTrackKey(track) === action.overId,
      );
      return oldIndex < 0 || newIndex < 0
        ? state
        : { ...state, tracks: arrayMove(state.tracks, oldIndex, newIndex) };
    }
    case "add-track":
      return {
        ...state,
        tracks: mergeUniqueTracks([...state.tracks, action.value]),
      };
    case "remove-track":
      return {
        ...state,
        tracks: state.tracks.filter(
          (track) => getTrackKey(track) !== action.key,
        ),
      };
    case "set-search":
      return { ...state, search: action.value };
    case "set-searching":
      return { ...state, searching: action.value };
    case "set-results":
      return { ...state, results: action.value };
    case "set-title-editing":
      return { ...state, titleEditing: action.value };
    case "set-description-editing":
      return { ...state, descriptionEditing: action.value };
  }
}

type PlaylistIdentityState = Pick<
  PlaylistComposerState,
  | "name"
  | "description"
  | "coverDataUrl"
  | "visibility"
  | "isCollaborative"
  | "tracks"
  | "titleEditing"
  | "descriptionEditing"
>;

function PlaylistIdentitySection({
  state,
  refs,
  dispatch,
  handleFileChange,
  t,
}: {
  state: PlaylistIdentityState;
  refs: {
    fileInputRef: { current: HTMLInputElement | null };
    titleInputRef: { current: HTMLInputElement | null };
    descriptionInputRef: { current: HTMLTextAreaElement | null };
  };
  dispatch: Dispatch<PlaylistComposerAction>;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const {
    name,
    description,
    coverDataUrl,
    visibility,
    isCollaborative,
    tracks,
    titleEditing,
    descriptionEditing,
  } = state;
  const { fileInputRef, titleInputRef, descriptionInputRef } = refs;

  return (
    <div className="flex items-start gap-4">
      <div className="relative flex-shrink-0">
        <PlaylistArtwork
          name={name || t("playlistComposer.newPlaylist")}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="h-24 w-24 rounded-xl shadow-2xl sm:h-28 sm:w-28"
        />
        <button
          type="button"
          className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1 rounded-full bg-surface-canvas/65 px-2.5 py-1.5 text-[11px] font-medium text-text-primary backdrop-blur-md transition-colors hover:bg-surface-canvas/80"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={12} />
          {t("playlistComposer.editCover")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-primary/40">
            {t("playlistComposer.playlistLabel")}
          </div>
          {titleEditing ? (
            <input
              ref={titleInputRef}
              type="text"
              placeholder={t("playlistComposer.namePlaceholder")}
              value={name}
              onChange={(event) =>
                dispatch({ type: "set-name", value: event.target.value })
              }
              onBlur={() =>
                dispatch({ type: "set-title-editing", value: false })
              }
              className="w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 py-2.5 text-xl font-semibold text-text-primary placeholder:text-text-muted focus:border-accent-action focus:outline-none"
            />
          ) : (
            <button
              type="button"
              className="w-full text-left text-xl font-semibold text-text-primary transition-colors hover:text-text-primary"
              onClick={() =>
                dispatch({ type: "set-title-editing", value: true })
              }
            >
              {name || t("playlistComposer.addTitle")}
            </button>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-primary/40">
            {t("playlistComposer.descriptionLabel")}
          </div>
          {descriptionEditing ? (
            <textarea
              ref={descriptionInputRef}
              rows={3}
              placeholder={t("playlistComposer.descriptionPlaceholder")}
              value={description}
              onChange={(event) =>
                dispatch({
                  type: "set-description",
                  value: event.target.value,
                })
              }
              onBlur={() =>
                dispatch({
                  type: "set-description-editing",
                  value: false,
                })
              }
              className="w-full resize-none rounded-lg border border-border-quiet bg-text-primary/5 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-action focus:outline-none"
            />
          ) : (
            <button
              type="button"
              className="w-full text-left text-sm leading-6 text-text-muted transition-colors hover:text-text-primary"
              onClick={() =>
                dispatch({
                  type: "set-description-editing",
                  value: true,
                })
              }
            >
              {description || t("playlistComposer.addDescription")}
            </button>
          )}
        </div>

        {coverDataUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border-quiet px-3 py-2 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            onClick={() => dispatch({ type: "set-cover", value: null })}
          >
            <ImagePlus size={14} />
            Use collage instead
          </button>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              visibility === "private"
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() =>
              dispatch({ type: "set-visibility", value: "private" })
            }
          >
            Private
          </button>
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              visibility === "public"
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() =>
              dispatch({ type: "set-visibility", value: "public" })
            }
          >
            Public
          </button>
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isCollaborative
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() => dispatch({ type: "toggle-collaborative" })}
          >
            Collaborative
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaylistTrackSearch({
  search,
  searching,
  results,
  t,
  onSearchChange,
  onAddTrack,
}: {
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  t: ReturnType<typeof useTranslation>["t"];
  onSearchChange: (value: string) => void;
  onAddTrack: (track: SearchTrackResult) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border-quiet bg-text-primary/5 px-3 py-2.5">
        <Search size={15} className="text-text-muted" />
        <input
          type="text"
          placeholder={t("playlistComposer.searchPlaceholder")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {searching ? (
          <Loader2 size={14} className="text-accent-action animate-spin" />
        ) : null}
      </div>

      {search.trim().length >= 2 ? (
        <div className="rounded-xl border border-border-quiet bg-text-primary/5">
          {results.length > 0 ? (
            <div className="max-h-44 overflow-y-auto py-1.5">
              {results.map((track) => (
                <button
                  key={searchTrackKey(track)}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-text-primary/5"
                  onClick={() => onAddTrack(track)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-primary">
                      {track.title}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {track.artist} · {track.album}
                    </div>
                  </div>
                  <span className="text-xs text-accent-action">
                    {t("common.add")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-text-muted">
              {t("playlistComposer.noTracksFound")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PlaylistTrackList({
  tracks,
  t,
  onDragEnd,
  onRemove,
}: {
  tracks: PlaylistComposerTrack[];
  t: ReturnType<typeof useTranslation>["t"];
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (track: PlaylistComposerTrack) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t("common.tracks")}
          </h3>
          <p className="text-xs text-text-muted">
            {tracks.length > 0
              ? t("playlistComposer.selectedCount", { count: tracks.length })
              : t("playlistComposer.addTracksLater")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border-quiet bg-text-primary/5">
        <div className="max-h-64 overflow-y-auto py-1.5">
          {tracks.length > 0 ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={tracks.map(getTrackKey)}
                strategy={verticalListSortingStrategy}
              >
                {tracks.map((track) => (
                  <SortableTrackItem
                    key={getTrackKey(track)}
                    track={track}
                    onRemove={() => onRemove(track)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              Start by searching for tracks or open this modal from an album or
              track menu.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlaylistCreateModal({
  open,
  mode = "create",
  initialName = "",
  initialDescription = "",
  initialCoverDataUrl = null,
  initialVisibility = "private",
  initialCollaborative = false,
  initialTracks,
  submitting,
  onClose,
  onSubmit,
}: PlaylistCreateModalProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    playlistComposerReducer,
    initialPlaylistComposerState,
  );
  const {
    name,
    description,
    coverDataUrl,
    visibility,
    isCollaborative,
    tracks,
    search,
    searching,
    results,
    titleEditing,
    descriptionEditing,
  } = state;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    dispatch({
      type: "reset",
      initialName,
      initialDescription,
      initialCoverDataUrl,
      initialVisibility,
      initialCollaborative,
      initialTracks,
    });
  }, [
    initialCollaborative,
    initialCoverDataUrl,
    initialDescription,
    initialName,
    initialTracks,
    initialVisibility,
    open,
  ]);

  useEffect(() => {
    if (!open || !titleEditing) return;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, titleEditing]);

  useEffect(() => {
    if (!open || !descriptionEditing) return;
    const timer = window.setTimeout(
      () => descriptionInputRef.current?.focus(),
      30,
    );
    return () => window.clearTimeout(timer);
  }, [descriptionEditing, open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = search.trim();
    if (query.length < 2) {
      dispatch({ type: "set-results", value: [] });
      dispatch({ type: "set-searching", value: false });
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      dispatch({ type: "set-searching", value: true });
      try {
        const response = await api<{ tracks: SearchTrackResult[] }>(
          `/api/catalog/search?q=${encodeURIComponent(query)}&limit=20`,
        );
        if (!cancelled) {
          dispatch({ type: "set-results", value: response.tracks || [] });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "set-results", value: [] });
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "set-searching", value: false });
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    dispatch({
      type: "move-track",
      activeId: String(active.id),
      overId: String(over.id),
    });
  }, []);

  if (!open) return null;

  const isEditMode = mode === "edit";
  const modalTitle = isEditMode
    ? t("playlistComposer.editTitle")
    : t("playlistComposer.createTitle");
  const modalSubtitle = isEditMode
    ? t("playlistComposer.editSubtitle")
    : t("playlistComposer.createSubtitle");
  const submitLabel = isEditMode
    ? t("playlistComposer.saveChanges")
    : t("playlistComposer.createPlaylist");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      dispatch({ type: "set-cover", value: dataUrl });
    } catch {
      dispatch({ type: "set-cover", value: null });
    } finally {
      event.target.value = "";
    }
  }

  function addTrack(track: PlaylistComposerTrack) {
    dispatch({ type: "add-track", value: track });
  }

  function removeTrack(track: PlaylistComposerTrack) {
    dispatch({ type: "remove-track", key: getTrackKey(track) });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    await onSubmit({
      name: trimmedName,
      description: description.trim(),
      coverDataUrl,
      visibility,
      isCollaborative,
      tracks,
    });
  }

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      maxWidthClassName="sm:max-w-3xl"
      panelClassName="listen-glass-panel border-border-quiet"
      closeOnEscape={!submitting}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[92vh]">
        <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {modalTitle}
            </h2>
            <p className="text-xs text-text-muted">{modalSubtitle}</p>
          </div>
          <ModalCloseButton onClick={onClose} disabled={submitting} />
        </ModalHeader>

        <ModalBody className="space-y-5 px-5 py-5">
          <PlaylistIdentitySection
            state={{
              name,
              description,
              coverDataUrl,
              visibility,
              isCollaborative,
              tracks,
              titleEditing,
              descriptionEditing,
            }}
            refs={{
              fileInputRef,
              titleInputRef,
              descriptionInputRef,
            }}
            dispatch={dispatch}
            handleFileChange={handleFileChange}
            t={t}
          />

          <PlaylistTrackSearch
            search={search}
            searching={searching}
            results={results}
            t={t}
            onSearchChange={(value) => dispatch({ type: "set-search", value })}
            onAddTrack={(track) => addTrack(toComposerTrack(track))}
          />

          <PlaylistTrackList
            tracks={tracks}
            t={t}
            onDragEnd={handleDragEnd}
            onRemove={removeTrack}
          />
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-text-primary/5 transition-colors"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {submitLabel}
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
