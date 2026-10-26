import {
  useCallback,
  useId,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { type DragEndEvent } from "@dnd-kit/core";
import { CollectionEditorDialog } from "../collections/CollectionEditorDialog";
import { api } from "@/lib/api";
import {
  fileToDataUrl,
  getTrackKey,
  initialPlaylistComposerState,
  playlistComposerReducer,
  toComposerTrack,
  type PlaylistComposerTrack,
  type SearchTrackResult,
} from "@/components/playlists/playlist-composer-model";
export type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";

import {
  PlaylistIdentitySection,
  PlaylistTrackList,
  PlaylistTrackSearch,
} from "@/components/playlists/PlaylistComposerSections";

interface PlaylistCreateModalProps {
  open: boolean;
  mode?: "create" | "edit";
  editorIdentity?: string | number;
  initialName?: string;
  initialDescription?: string;
  initialCoverDataUrl?: string | null;
  initialVisibility?: "public" | "private";
  initialCollaborative?: boolean;
  canManageSettings?: boolean;
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

export function PlaylistCreateModal({
  open,
  mode = "create",
  editorIdentity,
  initialName = "",
  initialDescription = "",
  initialCoverDataUrl = null,
  initialVisibility = "private",
  initialCollaborative = false,
  canManageSettings = true,
  initialTracks,
  submitting,
  onClose,
  onSubmit,
}: PlaylistCreateModalProps) {
  const { t } = useTranslation();
  const formId = useId();
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
  const initializedSession = useRef<{ identity: string | number } | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      initializedSession.current = null;
      return;
    }
    const identity = editorIdentity ?? mode;
    if (initializedSession.current?.identity === identity) return;
    initializedSession.current = { identity };
    setSearchError(false);
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
    editorIdentity,
    mode,
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
    setSearchError(false);
    if (query.length < 2) {
      dispatch({ type: "set-results", value: [] });
      dispatch({ type: "set-searching", value: false });
      return undefined;
    }

    let cancelled = false;
    dispatch({ type: "set-searching", value: true });
    const timer = window.setTimeout(async () => {
      try {
        const response = await api<{ tracks: SearchTrackResult[] }>(
          `/api/catalog/search?q=${encodeURIComponent(query)}&limit=20`,
        );
        if (!cancelled) {
          dispatch({ type: "set-results", value: response.tracks || [] });
        }
      } catch {
        if (!cancelled) {
          setSearchError(true);
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
  }, [open, search, searchAttempt]);

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
    const session = initializedSession.current;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (session === initializedSession.current)
        dispatch({ type: "set-cover", value: dataUrl });
    } catch {
      if (session === initializedSession.current)
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
    <CollectionEditorDialog
      open={open}
      title={modalTitle}
      description={modalSubtitle}
      formId={formId}
      submitLabel={submitLabel}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      pending={submitting}
      submitDisabled={!name.trim()}
      onCancel={onClose}
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
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
          canManageSettings={canManageSettings}
          t={t}
        />

        <PlaylistTrackSearch
          search={search}
          searching={searching}
          results={results}
          error={searchError ? t("search.errors.tryAgain") : undefined}
          onRetry={() => setSearchAttempt((attempt) => attempt + 1)}
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
      </form>
    </CollectionEditorDialog>
  );
}
